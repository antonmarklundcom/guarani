/**
 * Retry with backoff, and bounded concurrency — KNOWN-ISSUES #5.
 *
 * opus-1's go/no-go gate submitted twelve TTS jobs in parallel and one came
 * straight back with `429 rate_limit_reached`; an identical retry seconds later
 * succeeded. Under parallel submission that is normal traffic shaping, not a
 * failed job, and a phase that marks it failed loses a line of narration to a
 * transient. So submission retries, and concurrency is capped rather than
 * unbounded — the cheapest fix for a 429 is not sending the burst.
 */

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  /** Injected in tests so retry logic is verified without real waiting. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Transient by nature: rate limits, gateway hiccups, dropped sockets. Anything
 * else — a bad voice id, a malformed request — will fail identically on retry,
 * so retrying it just spends time and, on a metered API, possibly credits.
 */
export function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number } | null)?.status
    ?? (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === "number") {
    return status === 429 || status === 408 || (status >= 500 && status < 600);
  }

  const message = error instanceof Error ? error.message : String(error ?? "");

  // Named conditions are unambiguous.
  if (/rate[_ -]?limit|too many requests|service unavailable|bad gateway|gateway time-?out|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ECONNREFUSED/i
    .test(message)) {
    return true;
  }

  // A bare status code is only trusted where one actually appears: at the start
  // of the message, or after an explicit marker. Matching it anywhere would make
  // "voice id 500 does not exist" — a permanent error — burn the whole retry
  // budget on every line of every script.
  return /^\s*(?:HTTP\s*)?(?:429|408|5\d\d)\b|\b(?:status|code|HTTP)\s*[:=]?\s*(?:429|408|5\d\d)\b/i
    .test(message);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  // At least one attempt, always: `attempts: 0` would otherwise skip the loop
  // and throw an undefined `lastError`, which is an undiagnosable failure.
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) throw error;
      // Exponential with jitter: without the jitter a batch that hits a rate
      // limit together retries together and hits it again together.
      const delayMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random()));
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Runs `worker` over every item with at most `limit` in flight, preserving
 * input order in the results. Results are settled, not thrown: one line failing
 * to synthesize must not abandon the other eleven.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(
    items.length,
  );
  let next = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });

  await Promise.all(runners);
  return results;
}
