/**
 * Retry with exponential backoff — the first line of self-healing. Transient
 * failures (rate limits, network blips) are retried automatically; everything
 * else fails fast.
 */
import { AnvilError, errorMessage, isRetryable } from "../lib/errors.js";

const TRANSIENT_PATTERN =
  /(rate.?limit|overloaded|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|\b5\d\d\b|\b429\b|temporarily|timed? ?out)/i;

/** True when an error looks safe to retry. */
export function isTransientError(err: unknown): boolean {
  if (isRetryable(err)) return true;
  if (err instanceof AnvilError && (err.code === "RATE_LIMITED" || err.code === "CONTEXT_OVERFLOW")) {
    return err.code === "RATE_LIMITED";
  }
  return TRANSIENT_PATTERN.test(errorMessage(err));
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
  shouldRetry: (err: unknown, attempt: number) => boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  jitter: true,
  shouldRetry: (err) => isTransientError(err),
};

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

export type RetryNotice = (err: unknown, attempt: number, delayMs: number) => void;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `work`, retrying transient failures with exponential backoff. */
export async function withRetry<T>(
  work: (attempt: number) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  onRetry?: RetryNotice,
): Promise<RetryOutcome<T>> {
  const settings = { ...DEFAULT_RETRY_POLICY, ...policy };
  let lastError: unknown;
  for (let attempt = 1; attempt <= settings.maxAttempts; attempt++) {
    try {
      return { value: await work(attempt), attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt >= settings.maxAttempts || !settings.shouldRetry(err, attempt)) break;
      const backoff = Math.min(settings.maxDelayMs, settings.baseDelayMs * 2 ** (attempt - 1));
      const waitMs = Math.round(settings.jitter ? backoff * (0.5 + Math.random() * 0.5) : backoff);
      onRetry?.(err, attempt, waitMs);
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new AnvilError("RUNTIME_ERROR", errorMessage(lastError));
}
