/**
 * Local duration measurement — plan §3.3 and §11.4.
 *
 * Caption timing is true by construction: each script line is synthesized as
 * its own audio file and measured here, so offsets are known exactly. We never
 * transcribe (Whisper mis-transcribes Guaraní badly) and never trust provider
 * timing metadata (Higgsfield returns none at all).
 *
 * This is also what shrinks the TTS contract to "text in → one audio file out",
 * the weakest and therefore most portable thing any provider can offer.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export class FfprobeUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      "ffprobe is not available. The render worker host must have ffmpeg " +
        "installed (plan §7 human-inputs checklist).",
    );
    this.cause = cause;
  }
}

/** Measures an audio/video file's duration in milliseconds. */
export async function measureDurationMs(filePath: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]));
  } catch (cause) {
    throw new FfprobeUnavailableError(cause);
  }

  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe returned an unparseable duration for ${filePath}: ${stdout}`);
  }
  return Math.round(seconds * 1000);
}

/**
 * Turns measured per-line durations into caption offsets. Pure function, so it
 * is testable without ffprobe or any audio at all.
 */
export function lineOffsets(durationsMs: number[]): Array<{ startMs: number; endMs: number }> {
  const offsets: Array<{ startMs: number; endMs: number }> = [];
  let cursor = 0;
  for (const duration of durationsMs) {
    offsets.push({ startMs: cursor, endMs: cursor + duration });
    cursor += duration;
  }
  return offsets;
}
