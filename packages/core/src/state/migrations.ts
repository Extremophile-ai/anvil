/**
 * SQLite schema migrations. Each entry is applied in order; `PRAGMA
 * user_version` tracks how far a database has progressed. Append-only — never
 * edit a shipped migration.
 */

export const MIGRATIONS: readonly string[] = [
  // v1 — memory facts, their vectors, and the job ledger.
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE memory_facts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    scope       TEXT NOT NULL,
    type        TEXT NOT NULL,
    description TEXT NOT NULL,
    body        TEXT NOT NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (scope, name)
  );

  CREATE TABLE memory_vectors (
    memory_id TEXT PRIMARY KEY REFERENCES memory_facts(id) ON DELETE CASCADE,
    embedder  TEXT NOT NULL,
    dim       INTEGER NOT NULL,
    vector    BLOB NOT NULL
  );

  CREATE TABLE jobs (
    id         TEXT PRIMARY KEY,
    task       TEXT NOT NULL,
    status     TEXT NOT NULL,
    result     TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX idx_memory_facts_scope ON memory_facts(scope);
  CREATE INDEX idx_jobs_status ON jobs(status);
  `,

  // v2 — installed MCP servers.
  `
  CREATE TABLE mcp_servers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    transport    TEXT NOT NULL,
    command      TEXT,
    args         TEXT NOT NULL DEFAULT '[]',
    url          TEXT,
    package      TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    env          TEXT NOT NULL DEFAULT '{}',
    env_keys     TEXT NOT NULL DEFAULT '[]',
    homepage     TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL
  );
  `,

  // v3 — the learning loop: logged failures and the regression eval suite.
  `
  CREATE TABLE failures (
    id                  TEXT PRIMARY KEY,
    job_id              TEXT,
    what_happened       TEXT NOT NULL,
    root_cause          TEXT NOT NULL,
    fix_applied         TEXT NOT NULL,
    harness_improvement TEXT NOT NULL,
    severity            TEXT NOT NULL,
    created_at          TEXT NOT NULL
  );

  CREATE TABLE evals (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    scenario          TEXT NOT NULL,
    expectation       TEXT NOT NULL,
    source_failure_id TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL,
    last_run_at       TEXT
  );

  CREATE INDEX idx_evals_status ON evals(status);
  `,
];
