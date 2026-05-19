import { describe, expect, it } from "vitest";
import { AnvilError } from "../lib/errors.js";
import { isTransientError, withRetry } from "./retry.js";

const fast = { baseDelayMs: 1, jitter: false };

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const outcome = await withRetry(() => {
      calls += 1;
      return Promise.resolve(42);
    }, fast);
    expect(outcome.value).toBe(42);
    expect(outcome.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const outcome = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) {
          return Promise.reject(new AnvilError("RATE_LIMITED", "rate limit", { retryable: true }));
        }
        return Promise.resolve("ok");
      },
      { ...fast, maxAttempts: 5 },
    );
    expect(outcome.value).toBe("ok");
    expect(outcome.attempts).toBe(3);
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(
      withRetry(() => {
        calls += 1;
        return Promise.reject(new AnvilError("INVALID_INPUT", "bad input"));
      }, fast),
    ).rejects.toThrow(/bad input/);
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(new Error("ETIMEDOUT"));
        },
        { ...fast, maxAttempts: 3 },
      ),
    ).rejects.toThrow(/ETIMEDOUT/);
    expect(calls).toBe(3);
  });

  it("detects transient errors", () => {
    expect(isTransientError(new Error("Request failed with status 429"))).toBe(true);
    expect(isTransientError(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientError(new Error("a perfectly ordinary bug"))).toBe(false);
  });
});
