/**
 * The failure log — `log_failure`'s backing store. Every corrected mistake is
 * written to SQLite and appended to a human-readable `failures.md`. That file
 * is Anvil's institutional memory: the data the learning loop mines.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StateStore } from "../state/store.js";
import type { FailureEntry, FailureInput } from "./types.js";

const MARKDOWN_HEADER = `# Failures Log — Anvil's Institutional Memory

Every entry is a corrected mistake and the structural fix made in response.
Appended automatically by the \`log_failure\` tool.
`;

function renderEntry(entry: FailureEntry): string {
  return [
    "",
    `## ${entry.createdAt} — severity: ${entry.severity}`,
    "",
    `- **What happened:** ${entry.whatHappened}`,
    `- **Root cause:** ${entry.rootCause}`,
    `- **Fix applied:** ${entry.fixApplied}`,
    `- **Harness improvement:** ${entry.harnessImprovement}`,
    "",
  ].join("\n");
}

function rowToEntry(row: Record<string, unknown>): FailureEntry {
  return {
    id: String(row.id),
    jobId: row.job_id == null ? undefined : (String(row.job_id) as FailureEntry["jobId"]),
    whatHappened: String(row.what_happened),
    rootCause: String(row.root_cause),
    fixApplied: String(row.fix_applied),
    harnessImprovement: String(row.harness_improvement),
    severity: String(row.severity) as FailureEntry["severity"],
    createdAt: String(row.created_at),
  };
}

export interface FailureLogDeps {
  store: StateStore;
  /** Path to the human-readable `failures.md`. */
  failuresPath: string;
}

export class FailureLog {
  constructor(private readonly deps: FailureLogDeps) {}

  /** Record a failure to SQLite and append it to `failures.md`. */
  record(input: FailureInput): FailureEntry {
    const entry: FailureEntry = { ...input, id: `fail_${randomUUID()}`, createdAt: new Date().toISOString() };
    this.deps.store.db
      .prepare(
        `INSERT INTO failures
           (id, job_id, what_happened, root_cause, fix_applied, harness_improvement, severity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.jobId ?? null,
        entry.whatHappened,
        entry.rootCause,
        entry.fixApplied,
        entry.harnessImprovement,
        entry.severity,
        entry.createdAt,
      );
    this.appendMarkdown(entry);
    return entry;
  }

  list(): FailureEntry[] {
    const rows = this.deps.store.db
      .prepare("SELECT * FROM failures ORDER BY created_at")
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToEntry);
  }

  count(): number {
    const row = this.deps.store.db.prepare("SELECT COUNT(*) AS n FROM failures").get() as { n?: number };
    return Number(row.n ?? 0);
  }

  private appendMarkdown(entry: FailureEntry): void {
    const path = this.deps.failuresPath;
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, MARKDOWN_HEADER);
    }
    appendFileSync(path, renderEntry(entry));
  }
}
