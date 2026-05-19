/**
 * Escalation — when self-healing cannot make progress, the harness stops and
 * hands the problem to a human rather than thrashing.
 */
import type { JobId } from "@anvil/shared";
import { AnvilError } from "../lib/errors.js";

export interface EscalationInfo {
  jobId: JobId;
  label: string;
  error: unknown;
  strikes: number;
  history: string[];
}

/** Called when the harness gives up and needs human attention. */
export type Escalator = (info: EscalationInfo) => void | Promise<void>;

export class EscalationError extends AnvilError {
  readonly label: string;
  readonly strikes: number;

  constructor(label: string, strikes: number, cause?: unknown) {
    super(
      "MAX_RETRIES_EXCEEDED",
      `Anvil is stuck on "${label}" after ${strikes} attempt(s) and is escalating to a human.`,
      { cause },
    );
    this.name = "EscalationError";
    this.label = label;
    this.strikes = strikes;
  }
}
