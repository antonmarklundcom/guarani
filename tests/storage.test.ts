/**
 * Storage degradation tests — plan §4.
 *
 * The behaviour under test is the one that keeps unattended phases running:
 * missing bucket credentials must WARN and keep going, never throw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_VARS = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of STORAGE_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of STORAGE_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("archiveArtifact without configured storage", () => {
  it("reports storage as unconfigured", async () => {
    const { isStorageConfigured } = await import("@/storage");
    expect(isStorageConfigured()).toBe(false);
  });

  it("returns the provider URL marked non-durable instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { archiveArtifact } = await import("@/storage");

    const result = await archiveArtifact(
      "https://cdn.example/audio.wav",
      "tts/line-1.wav",
    );

    expect(result.url).toBe("https://cdn.example/audio.wav");
    expect(result.durable).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns only once across repeated calls", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { archiveArtifact } = await import("@/storage");

    await archiveArtifact("https://cdn.example/a.wav", "a.wav");
    await archiveArtifact("https://cdn.example/b.wav", "b.wav");

    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("storage configuration detection", () => {
  it("recognises a complete configuration", async () => {
    process.env.S3_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    process.env.S3_BUCKET = "guarani";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";

    const { isStorageConfigured } = await import("@/storage");
    expect(isStorageConfigured()).toBe(true);
  });

  it("treats a partial configuration as unconfigured", async () => {
    process.env.S3_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    process.env.S3_BUCKET = "guarani";
    // credentials deliberately absent

    const { isStorageConfigured } = await import("@/storage");
    expect(isStorageConfigured()).toBe(false);
  });
});
