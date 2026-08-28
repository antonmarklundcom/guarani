/**
 * A local stand-in for "a provider that returns audio" and "an S3 bucket".
 *
 * The TTS orchestrator's most important behaviour is the part that touches real
 * bytes: download the artifact, measure it with ffprobe, put it in our bucket.
 * Mocking that away would leave the one thing worth verifying — that measured
 * durations are real durations — untested, which is how opus-1 ended up with an
 * unproven `measureDurationMs`.
 *
 * So instead: ffmpeg generates tones of known length, a local HTTP server
 * serves them as a provider CDN would, and the same server accepts S3 PUTs. No
 * network egress, no credits, and the assertions are against durations that
 * were specified up front.
 */

import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";

const run = promisify(execFile);

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/** Writes a WAV of exactly `seconds` duration and returns its path. */
export async function makeTone(seconds: number, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "guarani-test-"));
  const path = join(dir, `${name}.wav`);
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-ar", "22050", "-ac", "1",
    path,
  ]);
  return path;
}

export type LocalAudioHost = {
  /** Base URL a "provider" would hand back. */
  baseUrl: string;
  /** Keys the fake bucket received, in order, with their byte lengths. */
  uploads: Array<{ key: string; bytes: number }>;
  close(): Promise<void>;
};

/**
 * Serves the given files at /audio/<name> and accepts any PUT as a bucket
 * write. The S3 client signs its requests properly; this end simply does not
 * check the signature, which is all the orchestrator's code path needs to be
 * exercised for real.
 */
export async function startLocalAudioHost(
  files: Record<string, string>,
): Promise<LocalAudioHost> {
  const uploads: Array<{ key: string; bytes: number }> = [];

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "PUT") {
      let bytes = 0;
      request.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      request.on("end", () => {
        uploads.push({ key: url.pathname.replace(/^\/+/, ""), bytes });
        response.writeHead(200, { ETag: '"local"' });
        response.end();
      });
      return;
    }

    const name = url.pathname.replace(/^\/audio\//, "");
    const path = files[name];
    if (!path) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    readFile(path).then(
      (body) => {
        response.writeHead(200, { "content-type": "audio/wav", "content-length": body.length });
        response.end(body);
      },
      () => {
        response.writeHead(500);
        response.end();
      },
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    uploads,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Points the storage module at the local host for the duration of a test. */
export function useLocalBucket(baseUrl: string): void {
  process.env.S3_ENDPOINT = baseUrl;
  process.env.S3_BUCKET = "guarani-test";
  process.env.S3_ACCESS_KEY_ID = "test";
  process.env.S3_SECRET_ACCESS_KEY = "test";
  process.env.S3_REGION = "auto";
}

export function clearLocalBucket(): void {
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete process.env.S3_REGION;
}
