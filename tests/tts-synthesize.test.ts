/**
 * TTS orchestration — plan §3.3, §5.2, and KNOWN-ISSUES #5.
 *
 * These tests run against real audio files of known length, served over a local
 * HTTP server, with ffprobe actually measuring them and a local endpoint
 * standing in for the bucket. Mocking the byte-handling away would leave the
 * single most important property — that a measured duration is a real duration —
 * unverified, which is exactly the gap opus-1 left behind (KNOWN-ISSUES #3).
 *
 * No credits are spent and no egress happens: the "provider" is a stub that
 * hands back local URLs.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TTSProvider, TTSResult } from "@/providers/types";
import { synthesizeLines } from "@/tts/synthesize";
import { downloadToTempFile } from "@/storage";
import { isRetryable, mapWithConcurrency, withRetry } from "@/tts/retry";
import { MemoryJobRepository } from "./helpers/memory-repos";
import {
  clearLocalBucket,
  ffmpegAvailable,
  makeTone,
  startLocalAudioHost,
  useLocalBucket,
  type LocalAudioHost,
} from "./helpers/local-audio";

const hasFfmpeg = await ffmpegAvailable();

/** Durations chosen to be unmistakable in an offset assertion. */
const TONES: Array<{ name: string; seconds: number }> = [
  { name: "line-001", seconds: 1 },
  { name: "line-002", seconds: 2 },
  { name: "line-003", seconds: 0.5 },
];

let host: LocalAudioHost;

beforeAll(async () => {
  if (!hasFfmpeg) return;
  const files: Record<string, string> = {};
  for (const tone of TONES) {
    files[`${tone.name}.wav`] = await makeTone(tone.seconds, tone.name);
  }
  host = await startLocalAudioHost(files);
});

afterAll(async () => {
  await host?.close();
});

afterEach(() => {
  clearLocalBucket();
});

/** Hands back a local URL per line, as a real provider hands back a CDN URL. */
function localProvider(options: { costUsd?: number | null; credits?: number } = {}): TTSProvider {
  let call = 0;
  return {
    name: "mock",
    async synthesize(): Promise<TTSResult> {
      const tone = TONES[call % TONES.length];
      call += 1;
      return {
        audioUrl: `${host.baseUrl}/audio/${tone.name}.wav`,
        // Deliberately a lie: the orchestrator must ignore provider timing and
        // measure the file itself (plan §3.3).
        durationMs: 99_999,
        timing: { granularity: "none" },
        rawCost: { provider: "mock", unit: "credit", amount: options.credits ?? 0.3 },
        costUsd: options.costUsd === undefined ? 0.015 : options.costUsd,
      };
    },
  };
}

const targets = TONES.map((tone, index) => ({
  lineId: index + 1,
  lineNumber: index + 1,
  speechText: `línea ${index + 1}`,
}));

describe.skipIf(!hasFfmpeg)("per-line synthesis with real audio", () => {
  it("measures each line with ffprobe instead of trusting the provider", async () => {
    const jobs = new MemoryJobRepository();
    const result = await synthesizeLines(targets, {
      provider: localProvider(),
      jobs,
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    expect(result.failures).toEqual([]);
    expect(result.audio.map((a) => a.durationMs)).toEqual([1000, 2000, 500]);
    // The provider claimed 99999ms for every line and was ignored.
    expect(result.audio.every((a) => a.durationMs !== 99_999)).toBe(true);
  });

  it("derives contiguous caption offsets from the measured durations", async () => {
    const result = await synthesizeLines(targets, {
      provider: localProvider(),
      jobs: new MemoryJobRepository(),
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    expect(result.offsets).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1000, endMs: 3000 },
      { startMs: 3000, endMs: 3500 },
    ]);
  });

  it("writes one job row per line, opened before the call and closed after", async () => {
    const jobs = new MemoryJobRepository();
    await synthesizeLines(targets, {
      provider: localProvider(),
      jobs,
      voiceRef: 1,
      engine: "elevenlabs",
      keyPrefix: "tts/test",
    });

    expect(jobs.jobs).toHaveLength(3);
    expect(jobs.jobs.every((j) => j.status === "completed")).toBe(true);
    expect(jobs.jobs.every((j) => j.kind === "tts")).toBe(true);
    expect(jobs.jobs.every((j) => j.engine === "elevenlabs")).toBe(true);
    expect(jobs.jobs.map((j) => j.inputRef?.scriptLineId)).toEqual([1, 2, 3]);
  });

  it("records raw credits and USD on every job", async () => {
    const jobs = new MemoryJobRepository();
    const result = await synthesizeLines(targets, {
      provider: localProvider({ credits: 0.3, costUsd: 0.015 }),
      jobs,
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    expect(result.totalCredits).toBeCloseTo(0.9, 6);
    expect(result.totalCostUsd).toBeCloseTo(0.045, 6);
    expect(jobs.jobs[0].completion?.costRawUnit).toBe("credit");
  });

  it("reports the total as unknown when a rate is not on file", async () => {
    // An unknown cost has to read as unknown; a zero would quietly understate
    // what a finished video costs (plan §11.8).
    const result = await synthesizeLines(targets, {
      provider: localProvider({ costUsd: null }),
      jobs: new MemoryJobRepository(),
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    expect(result.totalCostUsd).toBeNull();
    expect(result.totalCredits).toBeCloseTo(0.9, 6);
  });
});

describe.skipIf(!hasFfmpeg)("archiving to our own storage", () => {
  it("uploads each line and records our URL, not the provider's", async () => {
    useLocalBucket(host.baseUrl);
    const jobs = new MemoryJobRepository();

    const result = await synthesizeLines(targets, {
      provider: localProvider(),
      jobs,
      voiceRef: 1,
      keyPrefix: "tts/project-1/gn",
    });

    expect(host.uploads.length).toBeGreaterThanOrEqual(3);
    expect(host.uploads.map((u) => u.key)).toEqual(
      expect.arrayContaining([
        "guarani-test/tts/project-1/gn/line-001.wav",
        "guarani-test/tts/project-1/gn/line-002.wav",
        "guarani-test/tts/project-1/gn/line-003.wav",
      ]),
    );
    expect(result.audio.every((a) => a.durable)).toBe(true);
    expect(result.audio[0].audioUrl).not.toBe(result.audio[0].providerAudioUrl);
    // The provider URL is kept for reference, and assumed to expire.
    expect(result.audio[0].providerAudioUrl).toContain(host.baseUrl);
  });

  it("keeps going with the provider URL when storage is unconfigured", async () => {
    const result = await synthesizeLines(targets, {
      provider: localProvider(),
      jobs: new MemoryJobRepository(),
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    expect(result.failures).toEqual([]);
    expect(result.audio.every((a) => a.durable)).toBe(false);
    // One summary line, not one per line: repeated identical warnings hide the
    // line-specific ones sitting among them.
    const archival = result.warnings.filter((w) => w.includes("archived nowhere"));
    expect(archival).toHaveLength(1);
    expect(archival[0]).toContain("3 of 3");
  });
});

describe.skipIf(!hasFfmpeg)("failure handling", () => {
  it("fails one line without abandoning the others", async () => {
    let call = 0;
    const flaky: TTSProvider = {
      name: "mock",
      async synthesize() {
        call += 1;
        if (call === 2) throw new Error("400 invalid voice");
        return {
          audioUrl: `${host.baseUrl}/audio/line-001.wav`,
          durationMs: null,
          timing: { granularity: "none" as const },
          rawCost: { provider: "mock" as const, unit: "credit", amount: 0.3 },
          costUsd: 0.015,
        };
      },
    };

    const jobs = new MemoryJobRepository();
    const result = await synthesizeLines(targets, {
      provider: flaky,
      jobs,
      voiceRef: 1,
      keyPrefix: "tts/test",
      concurrency: 1,
      retry: { attempts: 1 },
    });

    expect(result.audio).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toContain("invalid voice");
    expect(jobs.jobs.filter((j) => j.status === "failed")).toHaveLength(1);
    // A gap in the timeline must not be papered over.
    expect(result.offsets).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)("spend that produced nothing is still recorded", () => {
  it("records the cost when a line fails AFTER the provider charged", async () => {
    // The credits are gone whether or not the download succeeded. A job row
    // reading "failed, cost unknown" is how a run under-reports what it spent
    // (plan §11.8), so the charge is captured the moment the provider answers.
    const charging: TTSProvider = {
      name: "mock",
      async synthesize() {
        return {
          audioUrl: `${host.baseUrl}/audio/does-not-exist.wav`,
          durationMs: null,
          timing: { granularity: "none" as const },
          rawCost: { provider: "mock" as const, unit: "credit", amount: 0.3 },
          costUsd: 0.015,
        };
      },
    };

    const jobs = new MemoryJobRepository();
    const result = await synthesizeLines([targets[0]], {
      provider: charging,
      jobs,
      voiceRef: 1,
      keyPrefix: "tts/test",
      retry: { attempts: 1 },
    });

    expect(result.audio).toEqual([]);
    expect(result.failures).toHaveLength(1);

    const job = jobs.jobs[0];
    expect(job.status).toBe("failed");
    expect(job.costUsd).toBe("0.015000");
    expect(result.totalCredits).toBeCloseTo(0.3, 6);
    expect(result.totalCostUsd).toBeCloseTo(0.015, 6);
    expect(result.warnings.some((w) => w.includes("AFTER the provider charged"))).toBe(true);
  });

  it("reports an unknown total rather than zero when nothing was attempted", async () => {
    const result = await synthesizeLines([], {
      provider: localProvider(),
      jobs: new MemoryJobRepository(),
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    // [].every() is true, so this needs asserting: no data must not read as free.
    expect(result.totalCostUsd).toBeNull();
    expect(result.totalCredits).toBe(0);
  });

  it("deletes the temp file it downloaded to", async () => {
    // The mechanism, deterministically: cleanup() removes the directory.
    const { path, cleanup } = await downloadToTempFile(
      `${host.baseUrl}/audio/line-001.wav`,
      "probe",
    );
    expect(existsSync(path)).toBe(true);
    await cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it("leaves no temp files behind after a run", async () => {
    // One directory per line per render, never reclaimed, adds up fast on a
    // long-lived worker host.
    //
    // Scoped by content hash rather than by counting `guarani-*` directories:
    // vitest runs test FILES in parallel, so a global count races with any
    // other suite that downloads something.
    const result = await synthesizeLines(targets, {
      provider: localProvider(),
      jobs: new MemoryJobRepository(),
      voiceRef: 1,
      keyPrefix: "tts/test",
    });

    // downloadToTempFile names files after a hash of the source URL, and this
    // suite's URLs carry a randomly assigned port — so these stems belong to
    // this run and no other.
    const stems = result.audio.map((line) =>
      createHash("sha1").update(line.providerAudioUrl).digest("hex").slice(0, 12),
    );
    expect(stems.length).toBe(3);

    const leftovers: string[] = [];
    for (const dir of (await readdir(tmpdir())).filter((d) => d.startsWith("guarani-"))) {
      const entries = await readdir(join(tmpdir(), dir)).catch(() => []);
      for (const entry of entries) {
        if (stems.some((stem) => entry.includes(stem))) leftovers.push(`${dir}/${entry}`);
      }
    }
    expect(leftovers).toEqual([]);
  });
});

describe("retry with backoff — KNOWN-ISSUES #5", () => {
  it("treats a rate limit as transient and anything else as final", () => {
    // opus-1 saw one of twelve parallel submissions return 429 and succeed on
    // an identical retry seconds later. That is traffic shaping, not a failure.
    expect(isRetryable(new Error("429 rate_limit_reached"))).toBe(true);
    expect(isRetryable(Object.assign(new Error("nope"), { status: 429 }))).toBe(true);
    expect(isRetryable(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);

    expect(isRetryable(new Error("400 invalid voice_id"))).toBe(false);
    expect(isRetryable(Object.assign(new Error("nope"), { status: 400 }))).toBe(false);

    // A permanent error that merely CONTAINS a number that looks like a status
    // code must not burn the retry budget on every line of every script.
    expect(isRetryable(new Error("voice id 500 does not exist"))).toBe(false);
    expect(isRetryable(new Error("listing 503 has no price"))).toBe(false);
    // …while a status code where one actually appears still counts.
    expect(isRetryable(new Error("HTTP 503 from upstream"))).toBe(true);
    expect(isRetryable(new Error("status: 429"))).toBe(true);
  });

  it("retries a 429 and returns the eventual success", async () => {
    let attempts = 0;
    const value = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("429 rate_limit_reached");
        return "ok";
      },
      { baseDelayMs: 1, sleep: async () => {} },
    );

    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not spend attempts on an error that will fail identically", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("400 invalid voice_id");
        },
        { baseDelayMs: 1, sleep: async () => {} },
      ),
    ).rejects.toThrow("invalid voice_id");

    expect(attempts).toBe(1);
  });

  it("always makes at least one attempt", async () => {
    // attempts:0 would otherwise skip the loop and reject with `undefined`,
    // which reaches the job row as the literal string "undefined".
    let called = false;
    const value = await withRetry(async () => { called = true; return "ok"; }, { attempts: 0 });
    expect(called).toBe(true);
    expect(value).toBe("ok");
  });

  it("gives up after the attempt budget", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("429 rate_limit_reached");
        },
        { attempts: 3, baseDelayMs: 1, sleep: async () => {} },
      ),
    ).rejects.toThrow("429");

    expect(attempts).toBe(3);
  });
});

describe("bounded concurrency", () => {
  it("never exceeds the limit and preserves input order", async () => {
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 10;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("settles rather than throwing, so one failure does not cancel the rest", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });

    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });
});
