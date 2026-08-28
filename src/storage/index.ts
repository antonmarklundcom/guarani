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

  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType:
        response.headers.get("content-type") ?? "application/octet-stream",
    }),
  );

  const base = env.publicBaseUrl ?? `${env.endpoint.replace(/\/$/, "")}/${env.bucket}`;
  return { url: `${base}/${key}`, durable: true, bytes: body.byteLength };
}
