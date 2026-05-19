/**
 * The eval suite. Each logged failure seeds an eval; "learning" means making
 * the suite pass. It is the regression gate the harness runs before declaring
 * a task done.
 */
import { randomUUID } from "node:crypto";
import type { StateStore } from "../state/store.js";
import type { EvalCase, EvalInput, EvalStatus } from "./types.js";

export type EvalChecker = (evalCase: EvalCase) => Promise<boolean> | boolean;

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ id: string; name: string; passed: boolean }>;
}

function rowToCase(row: Record<string, unknown>): EvalCase {
  return {
    id: String(row.id),
    name: String(row.name),
    scenario: String(row.scenario),
    expectation: String(row.expectation),
    sourceFailureId: row.source_failure_id == null ? undefined : String(row.source_failure_id),
    status: String(row.status) as EvalStatus,
    createdAt: String(row.created_at),
    lastRunAt: row.last_run_at == null ? undefined : String(row.last_run_at),
  };
}

export class EvalSuite {
  constructor(private readonly store: StateStore) {}

  add(input: EvalInput): EvalCase {
    const evalCase: EvalCase = {
      ...input,
      id: `eval_${randomUUID()}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.store.db
      .prepare(
        `INSERT INTO evals (id, name, scenario, expectation, source_failure_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evalCase.id,
        evalCase.name,
        evalCase.scenario,
        evalCase.expectation,
        evalCase.sourceFailureId ?? null,
        evalCase.status,
        evalCase.createdAt,
      );
    return evalCase;
  }

  list(status?: EvalStatus): EvalCase[] {
    const rows = (
      status
        ? this.store.db.prepare("SELECT * FROM evals WHERE status = ? ORDER BY created_at").all(status)
        : this.store.db.prepare("SELECT * FROM evals ORDER BY created_at").all()
    ) as Array<Record<string, unknown>>;
    return rows.map(rowToCase);
  }

  get(id: string): EvalCase | undefined {
    const row = this.store.db.prepare("SELECT * FROM evals WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToCase(row) : undefined;
  }

  markResult(id: string, passed: boolean): void {
    this.store.db
      .prepare("UPDATE evals SET status = ?, last_run_at = ? WHERE id = ?")
      .run(passed ? "passing" : "failing", new Date().toISOString(), id);
  }

  /** Run every eval through a checker and record the outcomes. */
  async run(checker: EvalChecker): Promise<EvalReport> {
    const results: EvalReport["results"] = [];
    for (const evalCase of this.list()) {
      const passed = await checker(evalCase);
      this.markResult(evalCase.id, passed);
      results.push({ id: evalCase.id, name: evalCase.name, passed });
    }
    return {
      total: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      results,
    };
  }
}
