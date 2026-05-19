/**
 * The job store — persists orchestrator jobs (the task, its plan, its status)
 * to the SQLite `jobs` table so a build survives a process restart.
 */
import { type JobId, type JobRecord, type JobStatus, type Plan, newJobId } from "@anvil/shared";
import { AnvilError } from "../lib/errors.js";
import type { StateStore } from "../state/store.js";

function rowToJob(row: Record<string, unknown>): JobRecord {
  const job: JobRecord = {
    id: String(row.id) as JobId,
    task: String(row.task),
    status: String(row.status) as JobStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (row.result != null) job.result = String(row.result);
  if (row.plan != null) {
    try {
      job.plan = JSON.parse(String(row.plan)) as Plan;
    } catch {
      // A corrupt plan column is treated as no plan rather than a hard failure.
    }
  }
  return job;
}

export interface JobPatch {
  status?: JobStatus;
  result?: string;
  plan?: Plan;
}

export class JobStore {
  constructor(private readonly store: StateStore) {}

  create(task: string): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = { id: newJobId(), task, status: "queued", createdAt: now, updatedAt: now };
    this.store.db
      .prepare(
        "INSERT INTO jobs (id, task, status, result, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(job.id, task, job.status, null, null, now, now);
    return job;
  }

  get(id: string): JobRecord | undefined {
    const row = this.store.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToJob(row) : undefined;
  }

  list(): JobRecord[] {
    const rows = this.store.db.prepare("SELECT * FROM jobs ORDER BY created_at").all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToJob);
  }

  update(id: string, patch: JobPatch): JobRecord {
    const existing = this.get(id);
    if (!existing) {
      throw new AnvilError("STATE_ERROR", `No job with id "${id}".`);
    }
    const next: JobRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };
    if (patch.result !== undefined) next.result = patch.result;
    if (patch.plan !== undefined) next.plan = patch.plan;

    this.store.db
      .prepare("UPDATE jobs SET status = ?, result = ?, plan = ?, updated_at = ? WHERE id = ?")
      .run(
        next.status,
        next.result ?? null,
        next.plan ? JSON.stringify(next.plan) : null,
        next.updatedAt,
        id,
      );
    return next;
  }
}
