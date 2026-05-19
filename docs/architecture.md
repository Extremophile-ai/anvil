# Anvil — Architecture

This is the design source of truth for Anvil. It merges the original brief
([`../BUILD_ME_A_HARNESS.md`](../BUILD_ME_A_HARNESS.md)) with the architecture
decisions taken in the design Q&A, and improves on both.

---

## 1. What Anvil is

Anvil is an **autonomous coding harness**. Give it a task — a product or a
feature — and it builds it end to end: frontend through backend microservices,
using every tool and resource available to it. It steers in real time, learns
from corrections, heals itself, and extends itself with new tools, skills, and
MCP servers as it needs them.

Two ideas, fused:

1. **The guardrail harness** (from the brief). A harness is executable
   infrastructure, not prompt rules. Every mistake is fixed *structurally* — a
   tool that cannot perform the bad operation — so it becomes impossible to
   repeat. Fixes compound across every future session and every future model.

2. **The autonomous engine** (from the Q&A). On top of the guardrail layer sits
   a real agent: an Opus-driven loop that plans, builds, tests, heals, and
   learns, exposed through a CLI, an MCP server, and an HTTP service.

The guardrail layer is what makes the autonomous engine *safe* to run
unattended. The learning loop's primary output is **new guardrails** — so Anvil
literally hardens itself the longer it runs.

> **Agent = Model + Harness.** Model upgrades reset raw intelligence. Harness
> investment never resets.

---

## 2. Locked decisions

| Area              | Decision                                                                          |
| ----------------- | --------------------------------------------------------------------------------- |
| Brain             | Claude Opus via the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)           |
| Cross-assistant   | Invokable over MCP (Codex / Gemini / Cursor can all call it)                      |
| Interfaces        | One `@anvil/core` engine behind a CLI + MCP server (stdio) + HTTP service         |
| First milestone   | Harness core — memory, learning, MCP-management plumbing                          |
| Autonomy          | Real-time steerable; corrections inject mid-task, through the host assistant      |
| Memory            | Hybrid — markdown facts + local vector index; per-project and global tiers        |
| Embeddings        | Local model by default; Voyage AI optional via config                            |
| Learning          | Reflection post-mortems + memory writes + a growing eval suite                    |
| MCP install       | Curated registry only; sandboxed; one-click approval per install                 |
| Self-healing      | Test-driven repair + runtime recovery + git checkpoint rollback + escalation      |
| Generated sandbox | Docker per task (Docker Compose for multi-service)                                |
| State             | Local-first: SQLite + local vectors                                              |
| Stack             | Adapt to existing repos; opinionated TypeScript default for greenfield            |
| Delivery          | Feature branch + pull request — never push to the default branch                 |
| Self-extension    | Generated skills / tools / plugins live in a global library (`~/.anvil/`)         |

---

## 3. How this improves on the original brief

The brief described a thin, single-purpose MCP server: domain tools that Claude
Code calls instead of raw bash. Anvil keeps every principle of that brief and
extends it. Where the two diverge, this is the resolution:

| Brief                                   | Anvil                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Single `harness/` folder, `src/tools`    | A pnpm **monorepo**, because one engine must serve a CLI **and** an MCP server **and** a service.       |
| "Keep it thin — no other frameworks"     | The **`mcp-server` package stays thin** (just the MCP SDK + zod, stdio). The heavy engine lives in `core`. "Thin" is honoured exactly where the brief meant it — the protocol surface. |
| Manual 6-question project interview      | Replaced by **automated ingestion** (structure, stack, contracts) + a short `anvil init` wizard for the human-judgment calls (dangerous ops, approval prefs). |
| `failures.md` + `log_failure` tool       | **Kept verbatim**, and wired into the reflection loop, the eval suite, and the skill factory.           |
| Two-phase approval, JSONL logging        | **Kept verbatim** as the contract for every write tool.                                                 |
| Tools replace raw access; never delete   | **Kept verbatim** as non-negotiable tool-design law (see §6).                                           |

Everything the brief mandated as *principle* is preserved. Only the *packaging*
grew, because Anvil does more than the brief's harness did.

---

## 4. Repository layout

```
anvil/
├─ package.json              pnpm workspace root + scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json         strict TS, ESM (NodeNext), composite
├─ tsconfig.json              project-reference root
├─ eslint.config.js  .prettierrc.json  vitest.config.ts
├─ .github/workflows/ci.yml   install · typecheck · lint · test
├─ failures.md                institutional memory (committed)
├─ docs/architecture.md       this document
└─ packages/
   ├─ shared/        @anvil/shared      — types + zod schemas
   ├─ core/          @anvil/core        — the engine (see §5)
   ├─ cli/           @anvil/cli         — the `anvil` command
   ├─ mcp-server/    @anvil/mcp-server  — MCP (stdio) façade — kept thin
   └─ service/       @anvil/service     — HTTP + queue daemon
```

Runtime state lives outside the repo:

- `<project>/.anvil/` — per-project memory, profile, evals, logs.
- `~/.anvil/` — global memory, the skill/tool/plugin library, the MCP registry.

---

## 5. The `@anvil/core` engine

`core` is organised as one module per subsystem. Each is built in its own phase
(§9); Phase 1 ships the package skeleton only.

| Module          | Responsibility                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `runtime/`      | The agent loop — wraps the Claude Agent SDK + Opus; per-job inbound queue for mid-task steering.  |
| `orchestrator/` | Decomposes a task into a plan DAG (epics → tasks → steps); schedules frontend/backend nodes.      |
| `memory/`       | Hybrid memory: markdown file layer + local vector index + a write/recall/dedup manager.          |
| `learning/`     | Reflection post-mortems, the eval suite, and `log_failure`.                                      |
| `healing/`      | Git checkpoints, runtime recovery, the retry/escalation policy, the test-driven repair loop.     |
| `mcp/`          | MCP client (consume tools) + curated registry + sandboxed approved installs.                     |
| `skills/`       | The self-extension factory + the global skill/tool/plugin library.                               |
| `ingestion/`    | Stack detection, dependency graph, the project profile, code indexing.                           |
| `sandbox/`      | Docker per-task lifecycle; Docker Compose for multi-service builds.                              |
| `git/`          | Feature branches, checkpoint commits, pull requests (`gh` / Octokit).                            |
| `tools/`        | The tool layer — scaffolding / discovery / contract / file-op / package / learning tools (§6).   |
| `state/`        | The SQLite store — jobs, the plan DAG, history, the eval suite.                                  |
| `events/`       | The event bus + structured JSONL logging that the host assistant reads to follow progress.       |
| `lib/`          | Low-level shared utilities — `approval.ts`, `workspace.ts`, `logger.ts`.                          |

---

## 6. The tool layer — design law

Every tool Anvil exposes obeys these rules. They are not guidelines; they are
enforced in code.

1. **Tools replace raw access, not supplement it.** If a tool exists for an
   operation, that operation is never done via bash or direct filesystem access.
   The tool *is* the only way.
2. **Read-only tools run freely. Write tools require two-phase approval:**
   - Phase 1 — the tool returns a *preview* of exactly what it will do.
   - Phase 2 — the user approves; the tool executes with a confirmation token.
   - The tool physically cannot execute without a valid, unexpired token.
3. **Every tool call is logged** to a structured JSONL file: timestamp, tool,
   inputs, result. This is the audit trail and the data for harness improvement.
4. **Error messages are actionable** — never "error occurred", always the exact
   state and the next step ("Component `EventCard` already exists at `…`; call
   `list_components` to see what exists").
5. **Boundaries are enforced mechanically** — path-traversal guards, repo
   boundary checks, contract validation. Code checks, not prompt instructions.
6. **No tool deletes.** Removal moves the target to a trash folder.

Conventions: tool names are `snake_case`; zod object schemas are `.strict()`;
every path is validated against the workspace root; tool files stay under ~200
lines; the MCP server logs to stderr (stdout is reserved for the protocol).

---

## 7. Self-healing

"Self-healing" covers four layers, all of them:

- **Test-driven code repair** — for code Anvil writes: generate/run tests,
  diagnose failures, fix, re-run; a bounded retry loop until green.
- **Runtime recovery** — the harness recovers from its *own* failures: tool
  errors, MCP server crashes, context overflow, API rate limits — retry with an
  adjusted strategy and backoff.
- **Git checkpoint rollback** — snapshot before risky steps; revert to the last
  known-good checkpoint instead of digging deeper into a broken state.
- **Escalate when stuck** — after N failed attempts on the same problem, stop
  and surface to the user rather than thrashing and burning tokens.

---

## 8. Memory & learning

**Memory** is hybrid and two-tiered:

- *File layer* — human-readable markdown facts, git-diffable, organised by type
  (`user` / `feedback` / `project` / `reference`). Per-project in `.anvil/` and
  global in `~/.anvil/`.
- *Vector layer* — a local embedding index for semantic recall at scale.
  Embeddings run on a local model by default; Voyage AI is an opt-in via config.

**Learning** turns corrections into durable improvement three ways at once:

- *Reflection* — after each task and each correction, a post-mortem distils
  lessons into memory facts and rules, and adjusts skills.
- *Memory writes* — corrections you give mid-task are captured immediately.
- *Eval suite* — a growing local test/eval suite built from past mistakes; a
  regression gate that must pass before any task is called "done".

`log_failure` feeds all three: it appends to `failures.md`, seeds an eval, and
triggers a reflection pass.

---

## 9. Build roadmap

The first milestone is the harness **core**. Each phase ends at an approval
checkpoint — that is also where real-time steering happens.

**Milestone A — the core**

1. Scaffold the monorepo — *Phase 1, this commit.*
2. Runtime — Claude Agent SDK + Opus loop + the steering channel.
3. State + Memory — SQLite, the file memory layer, local vectors, the manager.
4. Self-healing — checkpoints, runtime recovery, retry/escalation.
5. Tool layer — two-phase approval, JSONL logging, the first guardrail tools.
6. MCP manager — client, curated registry, sandboxed approved installs.
7. Learning — reflection post-mortems, the eval suite, `log_failure`.
8. Skill factory — generation + the global library + per-skill evals.
9. Ingestion — stack detection, the project profile, code indexing.

**Milestone B** — the orchestrator and the Docker build pipeline (end-to-end
feature builds).

**Milestone C** — harden the MCP server and the HTTP service; `anvil init` for
plugging into any workspace.
