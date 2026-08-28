/**
 * Central env access. Plan §4: a missing env value degrades gracefully and is
 * documented in .env.example — it never blocks a build phase or a running job.
 * Only DATABASE_URL is genuinely required, and only at the point a query runs.
 */

export type StorageEnv = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicBaseUrl?: string;
};

/** Returns null (not a throw) when object storage is unconfigured. */
export function storageEnv(): StorageEnv | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION ?? "auto",
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
  };
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }
  return url;
}
