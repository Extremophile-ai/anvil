/**
 * The state store — a thin wrapper over a local SQLite database, using Node's
 * built-in `node:sqlite`. There is no native module to compile, so the harness
 * stays trivially portable into any workspace.
 *
 * `node:sqlite` is obtained via `process.getBuiltinModule` rather than an
 * `import` statement: bundlers and test runners that predate it strip the
 * `node:` prefix and fail to resolve the bare `sqlite` name. `getBuiltinModule`
 * sidesteps module resolution entirely, and the `import type` below is erased
 * at compile time so nothing tries to resolve it.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AnvilError } from "../lib/errors.js";
import { MIGRATIONS } from "./migrations.js";

const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  let version = row?.user_version ?? 0;
  for (; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) break;
    db.exec(sql);
    db.exec(`PRAGMA user_version = ${version + 1}`);
  }
}

export class StateStore {
  readonly db: DatabaseSync;

  constructor(readonly filePath: string) {
    try {
      if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
      this.db = new sqlite.DatabaseSync(filePath);
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      migrate(this.db);
    } catch (err) {
      throw new AnvilError("STATE_ERROR", `Failed to open the state database at "${filePath}".`, {
        cause: err,
      });
    }
  }

  /** An ephemeral in-memory store — for tests and dry runs. */
  static memory(): StateStore {
    return new StateStore(":memory:");
  }

  close(): void {
    this.db.close();
  }
}
