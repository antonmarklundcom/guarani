/**
 * TTS orchestration — plan §5.2 and §3.3.
 *
 * One audio file per script line, every one of them measured locally. The
 * per-line shape is not a convenience: it is what makes caption timing true by
 * construction (plan §11.4). Higgsfield returns no timing metadata at all — the
 * opus-1 diagnostics confirmed this by observation, not assumption — and
 * Whisper mis-transcribes Guaraní badly enough to be useless. So the only
 * trustworthy source of "when does line 4 start" is the sum of the measured
 * durations of lines 1–3, which requires one file per line.
 *
 * The rule that follows from that, and is enforced below: `durationMs` on a job
 * row ONLY ever comes from ffprobe. `TTSResult.durationMs` from a provider is
 * deliberately ignored, even when a provider offers one, because the moment a
 * mixed pipeline exists nobody can tell which rows are measured and which are
 * claimed.
 *
 * Every call is bracketed by a `generation_jobs` row, written before the
 * provider is touched so a crashed call still leaves evidence, and closed with
 * raw + USD cost (plan §2 — cost blindness is §11.8's failure mode).
 */

import { lineOffsets, measureDurationMs } from "@/providers/duration";
import type { TTSProvider } from "@/providers/types";
import { archiveLocalFile, downloadToTempFile } from "@/storage";
import type { JobCost, JobRepository } from "@/ports";
import { mapWithConcurrency, withRetry, type RetryOptions } from "./retry";

export type SynthesisTarget = {
  /**
   * The real `script_lines.id`, or null when this text has no stored line —
   * typed straight into the standalone route, say.
   *
   * Null rather than a placeholder on purpose: `input_ref.scriptLineId` is a
   * reference, and a fabricated one is worse than an absent one. An id like
   * `1` looks joinable and will happily match some other project's line in any
   * later job→line query.
   */
  lineId: number | null;
  lineNumber: number;
  speechText: string;
};

export type LineAudio = {
  lineId: number | null;
  lineNumber: number;
  jobId: number;
  /** Our storage URL when durable, the provider's when storage is unconfigured. */
  audioUrl: string;
  providerAudioUrl: string;
  /** Measured with ffprobe. Null only when ffprobe is unavailable. */
  durationMs: number | null;
  durable: boolean;
  costUsd: number | null;
  creditsSpent: number;
};

export type LineFailure = {
  lineId: number | null;
  lineNumber: number;
  jobId: number;
  error: string;
};

export type SynthesisResult = {
  audio: LineAudio[];
  failures: LineFailure[];
  /** Contiguous caption offsets, present only when every line was measured. */
  offsets: Array<{ startMs: number; endMs: number }> | null;
  totalCostUsd: number | null;
  totalCredits: number;
  warnings: string[];
};

export type SynthesizeOptions = {
  provider: TTSProvider;
  jobs: JobRepository;
  voiceRef: number;
  /** Recorded on the job row so A/B results are queryable per engine. */
  engine?: string | null;
  /** Groups a set of jobs as one A/B run. Lands in `input_ref`. */
  abRunId?: string;
  /** Storage key prefix, e.g. "tts/project-7/gn". */
  keyPrefix: string;
  /** Capped by default — see retry.ts on why bursts cause 429s. */
  concurrency?: number;
  retry?: RetryOptions;
};

export async function synthesizeLines(
  targets: readonly SynthesisTarget[],
  options: SynthesizeOptions,
): Promise<SynthesisResult> {
  const warnings: string[] = [];
  // Conditions that apply to the whole run are summarized once at the end
  // rather than repeated per line — twelve identical warnings hide the one
  // line-specific warning sitting among them.
  const measurementErrors = new Set<string>();
  // Credits charged for lines that then failed. Real spend that produced
  // nothing, and it belongs in the totals rather than silently vanishing.
  let wastedCredits = 0;
  let wastedCostUsd: number | null = 0;
  const concurrency = options.concurrency ?? 3;

  const settled = await mapWithConcurrency(targets, concurrency, async (target) => {
    const jobId = await options.jobs.create({
      kind: "tts",
      provider: options.provider.name,
      engine: options.engine ?? null,
      inputRef: {
        ...(target.lineId === null ? {} : { scriptLineId: target.lineId }),
        lineNumber: target.lineNumber,
        ...(options.abRunId ? { abRunId: options.abRunId } : {}),
      },
    });

    // Captured as soon as the provider answers, so a failure AFTER that point
    // still records what was spent. The credits are gone either way, and a job
    // row reading "failed, cost unknown" is how a run under-reports its true
    // cost (plan §11.8).
    let spent: JobCost | null = null;
    let cleanup: (() => Promise<void>) | null = null;

    const retry = {
      ...options.retry,
      onRetry: (error: unknown, attempt: number, delayMs: number) => {
        warnings.push(
          `line ${target.lineNumber}: retrying after ${describe(error)} ` +
            `(attempt ${attempt}, waiting ${delayMs}ms)`,
        );
        options.retry?.onRetry?.(error, attempt, delayMs);
      },
    };

    try {
      await options.jobs.markRunning(jobId);

      const result = await withRetry(
        () => options.provider.synthesize({ text: target.speechText, voiceRef: options.voiceRef }),
        retry,
      );

      spent = {
        costRawAmount: result.rawCost.amount,
        costRawUnit: result.rawCost.unit,
        costUsd: result.costUsd,
      };

      // Retried like the submission: the audio is already paid for, so
      // discarding it over one transient download failure wastes real credits.
      const download = await withRetry(
        () =>
          downloadToTempFile(
            result.audioUrl,
            `line-${String(target.lineNumber).padStart(3, "0")}`,
          ),
        retry,
      );
      cleanup = download.cleanup;

      let durationMs: number | null = null;
      try {
        durationMs = await measureDurationMs(download.path);
      } catch (error) {
        // ffprobe missing is a host problem (plan §7), not a reason to throw
        // away audio we already paid for. The job completes with a null
        // duration and the caller learns it cannot lay captions yet.
        measurementErrors.add(describe(error));
      }

      const stored = await archiveLocalFile(
        download.path,
        `${options.keyPrefix}/line-${String(target.lineNumber).padStart(3, "0")}${extension(download.path)}`,
        download.contentType ?? undefined,
      );

      await options.jobs.complete(jobId, {
        outputUrl: forStorage(stored.durable ? stored.url : result.audioUrl),
        providerOutputUrl: forStorage(result.audioUrl),
        durationMs,
        ...spent,
      });

      const audio: LineAudio = {
        lineId: target.lineId,
        lineNumber: target.lineNumber,
        jobId,
        audioUrl: stored.durable ? stored.url : result.audioUrl,
        providerAudioUrl: result.audioUrl,
        durationMs,
        durable: stored.durable,
        costUsd: result.costUsd,
        creditsSpent: result.rawCost.amount,
      };
      return audio;
    } catch (error) {
      const message = describe(error);
      await options.jobs.fail(jobId, message, spent ?? undefined);
      if (spent) {
        wastedCredits += spent.costRawAmount;
        wastedCostUsd = spent.costUsd === null || wastedCostUsd === null
          ? null
          : wastedCostUsd + spent.costUsd;
        warnings.push(
          `line ${target.lineNumber}: failed AFTER the provider charged ` +
            `${spent.costRawAmount} ${spent.costRawUnit} — the spend is recorded on ` +
            "the job row but produced nothing usable.",
        );
      }
      throw Object.assign(new Error(message), {
        lineId: target.lineId,
        lineNumber: target.lineNumber,
        jobId,
      });
    } finally {
      await cleanup?.();
    }
  });

  const audio: LineAudio[] = [];
  const failures: LineFailure[] = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.ok) {
      audio.push(outcome.value);
      continue;
    }
    const error = outcome.error as { lineId?: number | null; jobId?: number; message?: string };
    failures.push({
      lineId: error.lineId === undefined ? targets[i].lineId : error.lineId,
      lineNumber: targets[i].lineNumber,
      jobId: error.jobId ?? -1,
      error: error.message ?? describe(outcome.error),
    });
  }

  for (const message of measurementErrors) {
    warnings.push(`duration not measured — ${message}`);
  }
  const notArchived = audio.filter((line) => !line.durable).length;
  if (notArchived > 0) {
    warnings.push(
      `${notArchived} of ${audio.length} line(s) archived nowhere — object ` +
        "storage is unconfigured, so those URLs are provider-hosted and may expire.",
    );
  }

  // Totals count every credit the provider charged, including for lines that
  // failed after being charged — otherwise a run reports less than it spent.
  const totalCredits =
    audio.reduce((sum, line) => sum + line.creditsSpent, 0) + wastedCredits;

  const costs = audio.map((line) => line.costUsd);
  const totalCostUsd =
    // Nothing attempted, or nothing succeeded and nothing was charged: the cost
    // is unknown, not zero. `[].every()` is true, so this needs saying.
    audio.length === 0 && wastedCredits === 0
      ? null
      : costs.every((c) => c !== null) && wastedCostUsd !== null
        ? costs.reduce((sum: number, c) => sum + (c as number), 0) + wastedCostUsd
        : null;

  return {
    audio,
    failures,
    offsets: captionOffsets(audio, targets.length),
    totalCostUsd,
    totalCredits,
    warnings,
  };
}

/**
 * Offsets are all-or-nothing on purpose. A partial timeline silently
 * desynchronizes every caption after the first gap, which is worse than an
 * obviously missing one — so a single unmeasured or failed line yields null and
 * the assembly step (opus-3) knows not to try.
 */
function captionOffsets(
  audio: LineAudio[],
  expectedLines: number,
): Array<{ startMs: number; endMs: number }> | null {
  if (audio.length !== expectedLines) return null;
  const ordered = [...audio].sort((a, b) => a.lineNumber - b.lineNumber);
  if (ordered.some((line) => line.durationMs === null)) return null;

  return lineOffsets(ordered.map((line) => line.durationMs as number));
}

function extension(path: string): string {
  const match = /\.[a-z0-9]+$/i.exec(path);
  return match ? match[0] : "";
}

/**
 * A `data:` URL is inline content, not a locatable resource: storing one in a
 * URL column means persisting the whole payload, which overflows the column and
 * tells a later reader nothing they can act on. The mock provider returns them
 * (so the pipeline can run without credits), so this is a real code path, not a
 * hypothetical one.
 */
function forStorage(url: string): string {
  if (!url.startsWith("data:")) return url;
  const [header] = url.split(",", 1);
  return `${header},<${url.length - header.length - 1} inline bytes>`;
}

/**
 * Error text is bounded before it goes anywhere near a column. A driver error
 * quotes the failing statement's parameters, so an oversized value produces an
 * error message containing that same oversized value — and storing THAT then
 * fails too, turning one bad row into a failure with no record of why.
 */
const MAX_ERROR_LENGTH = 2000;

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_ERROR_LENGTH)}… (${message.length} chars truncated)`;
}
