/**
 * Runtime recovery — classifying failures into an action, and tracking how many
 * times the harness has struck out on the same problem.
 */
import { AnvilError, errorMessage } from "../lib/errors.js";
import { isTransientError } from "./retry.js";

export type RecoveryAction = "retry" | "restore" | "escalate" | "fail";

export interface Diagnosis {
  action: RecoveryAction;
  reason: string;
}

/** Decide how the harness should respond to a failure. */
export function classifyError(err: unknown): Diagnosis {
  if (isTransientError(err)) {
    return { action: "retry", reason: "Transient error — safe to retry." };
  }
  if (err instanceof AnvilError) {
    if (err.code === "CONTEXT_OVERFLOW") {
      return { action: "restore", reason: "Context overflowed — roll back and re-approach." };
    }
    if (err.code === "MAX_RETRIES_EXCEEDED") {
      return { action: "escalate", reason: "Retries exhausted." };
    }
  }
  return { action: "fail", reason: `Unrecoverable: ${errorMessage(err)}` };
}

/**
 * Tracks repeated failures keyed by problem. Once a key is hit `limit` times,
 * the harness stops digging and escalates.
 */
export class StrikeBoard {
  private readonly strikes = new Map<string, number>();

  constructor(private readonly limit = 3) {}

  record(key: string): number {
    const next = this.count(key) + 1;
    this.strikes.set(key, next);
    return next;
  }

  count(key: string): number {
    return this.strikes.get(key) ?? 0;
  }

  exceeded(key: string): boolean {
    return this.count(key) >= this.limit;
  }

  clear(key: string): void {
    this.strikes.delete(key);
  }
}
