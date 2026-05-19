/**
 * Types for the learning loop — failures, the lessons distilled from a run, and
 * the regression evals that guard against a repeat.
 */
import type { JobId, MemoryType } from "@anvil/shared";

export type Severity = "low" | "medium" | "high" | "critical";

/** A corrected mistake, as recorded by `log_failure`. */
export interface FailureInput {
  jobId?: JobId;
  whatHappened: string;
  rootCause: string;
  fixApplied: string;
  /** The permanent, structural change that makes the mistake impossible. */
  harnessImprovement: string;
  severity: Severity;
}

export interface FailureEntry extends FailureInput {
  id: string;
  createdAt: string;
}

/** A lesson distilled by reflection — stored as a memory fact. */
export interface Lesson {
  description: string;
  body: string;
  type: MemoryType;
  tags: string[];
}

export type EvalStatus = "pending" | "passing" | "failing";

export interface EvalInput {
  name: string;
  scenario: string;
  expectation: string;
  sourceFailureId?: string;
}

export interface EvalCase extends EvalInput {
  id: string;
  status: EvalStatus;
  createdAt: string;
  lastRunAt?: string;
}

export interface ReflectionInput {
  jobId: JobId;
  task: string;
  outcome: "success" | "failure";
  /** Corrections the user injected during the run. */
  corrections: string[];
  /** Notable events — errors, escalations — worth learning from. */
  notes?: string[];
}

/** Turns a run into lessons. The heuristic implementation is deterministic;
 *  an LLM-backed one can be supplied for richer post-mortems. */
export interface Distiller {
  distill(input: ReflectionInput): Promise<Lesson[]>;
}
