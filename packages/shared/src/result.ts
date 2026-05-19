/**
 * The outcome of a single runtime run.
 */
import type { JobId } from "./ids.js";

export interface RunResult {
  jobId: JobId;
  /** True when the agent finished the task without error. */
  ok: boolean;
  /** The agent's final text output (a summary of what it did). */
  result: string;
  /** Number of agent turns the run took. */
  numTurns: number;
  durationMs: number;
  costUsd: number;
  /** True when the run was stopped by an explicit interrupt. */
  interrupted: boolean;
  /** Present when `ok` is false. */
  error?: string;
}
