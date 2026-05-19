/**
 * A job — one end-to-end build the orchestrator runs: a task, the plan it was
 * decomposed into, and where it stands.
 */
import { z } from "zod";
import type { JobId } from "./ids.js";
import type { Plan } from "./plan.js";

export type JobStatus =
  | "queued"
  | "planning"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobRecord {
  id: JobId;
  task: string;
  status: JobStatus;
  plan?: Plan;
  /** A summary of the outcome, filled in when the job finishes. */
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export const jobStatusSchema = z.enum([
  "queued",
  "planning",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
