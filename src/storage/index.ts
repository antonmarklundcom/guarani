/**
 * Object storage — plan §1 and review edit A4.2.
 *
 * The real lock-in is assets, not code. Provider-hosted output URLs are assumed
 * to expire, so every completed generation job downloads its artifact into our
 * own bucket immediately. That is why this ships in opus-1 rather than at
 * deploy time: the first job that completes without it is already at risk.
 *
 * Degradation (plan §4): if the bucket env vars are absent, this does NOT
 * throw and does NOT block. It warns once, returns the provider URL unchanged,
 * and flags the result as not-durable so callers can record that truthfully.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { storageEnv } from "@/config/env";

export type StoredArtifact = {
  /** Our URL when durable, the provider's URL when storage is unconfigured. */
  url: string;
  /** False means the URL is provider-hosted and may expire. */
  durable: boolean;
  bytes?: number;
};

let warned = false;

function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[storage] Object storage is not configured (S3_ENDPOINT / S3_BUCKET / " +
      "S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY). Provider URLs will be kept " +
      "as-is and are assumed to expire. See .env.example.",
  );
}

function client(): S3Client | null {
  const env = storageEnv();
  if (!env) return null;

  return new S3Client({
    region: env.region,
    endpoint: env.endpoint,
    // Path-style addressing: R2 and every other S3-compatible endpoint accept
    // it, whereas virtual-host style requires per-bucket DNS that a custom
    // endpoint generally does not have.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
  });
}

export function isStorageConfigured(): boolean {
  return storageEnv() !== null;
}

/**
 * Downloads a provider artifact and puts it in our bucket.
 *
 * @param sourceUrl provider-hosted URL, assumed expiring
 * @param key destination key, e.g. "tts/2026/08/line-42.wav"
 */
export async function archiveArtifact(
  sourceUrl: string,
  key: string,
): Promise<StoredArtifact> {
  const env = storageEnv();
  const s3 = client();

  if (!env || !s3) {
    warnOnce();
    return { url: sourceUrl, durable: false };
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download artifact ${sourceUrl}: ${response.status} ${response.statusText}`,
    );
  }

  const body = new Uint8Array(await response.arrayBuffer());

  return put(s3, env, key, body, response.headers.get("content-type"));
}

/**
 * Puts a file that is already on local disk into our bucket.
 *
 * opus-2 needs this because the TTS pipeline has to touch the bytes on the way
 * past: every line's duration is measured locally with ffprobe (plan §3.3), and
 * ffprobe reads a file, not a buffer. Downloading once to a temp file, probing
 * it, and uploading from there beats fetching the same artifact twice.
 */
export async function archiveLocalFile(
  filePath: string,
  key: string,
  contentType?: string,
): Promise<StoredArtifact> {
  const env = storageEnv();
  const s3 = client();

  if (!env || !s3) {
    warnOnce();
    return { url: filePath, durable: false };
  }

  return put(s3, env, key, await readFile(filePath), contentType ?? null);
}

async function put(
  s3: S3Client,
  env: NonNullable<ReturnType<typeof storageEnv>>,
  key: string,
  body: Uint8Array,
  contentType: string | null,
): Promise<StoredArtifact> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    }),
  );

  const base = env.publicBaseUrl ?? `${env.endpoint.replace(/\/$/, "")}/${env.bucket}`;
  return { url: `${base}/${key}`, durable: true, bytes: body.byteLength };
}

export type DownloadedArtifact = {
  path: string;
  contentType: string | null;
  /**
   * Removes the temp directory. Callers MUST invoke this — one file per script
   * line per render adds up on a long-lived worker host, and nothing else ever
   * reclaims them.
   */
  cleanup: () => Promise<void>;
};

/**
 * Downloads an artifact to a temp file so it can be measured before it is
 * archived. Separate from the upload half because a caller with no storage
 * configured still needs the local file for ffprobe.
 */
export async function downloadToTempFile(
  sourceUrl: string,
  suggestedName = "artifact",
): Promise<DownloadedArtifact> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download artifact ${sourceUrl}: ${response.status} ${response.statusText}`,
    );
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "guarani-"));
  // The URL is hashed into the name rather than used directly: provider URLs
  // carry query strings and path separators that do not belong in a filename.
  const stem = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12);
  const path = join(dir, `${suggestedName}-${stem}${extensionFor(sourceUrl)}`);
  await writeFile(path, body);
  return {
    path,
    contentType: response.headers.get("content-type"),
    // Swallows its own failure: a temp file that will not delete is not a
    // reason to fail a job whose audio was already produced and archived.
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  };
}

/** ffprobe sniffs content, but a sensible extension keeps temp files debuggable. */
function extensionFor(url: string): string {
  const match = /\.(wav|mp3|m4a|aac|ogg|flac|mp4|webm)(?:$|\?)/i.exec(url);
  return match ? `.${match[1].toLowerCase()}` : "";
}
