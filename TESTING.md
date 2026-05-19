# Testing Anvil

Anvil is tested in four layers. The first three run offline with no API key and
make up the CI gate; the fourth makes a real model call and is opt-in.

## Quick start — the full gate

```bash
pnpm install
pnpm build      # tsc -b — strict typecheck of every package
pnpm lint       # eslint
pnpm test       # vitest — unit + integration tests
pnpm smoke      # end-to-end smoke against the built dist
```

If all four pass, every `@anvil/core` subsystem typechecks, its tests pass, and
the packaged engine works the way a consumer imports it. This is exactly what
CI runs ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## The four layers

### 1. Static — `pnpm build` + `pnpm lint`

`tsc -b` type-checks all five packages under strict TypeScript (project
references, `NodeNext` ESM). `eslint` enforces lint rules. A type error or lint
violation fails here.

### 2. Unit + integration — `pnpm test`

`vitest` runs every `*.test.ts` under `packages/*/src`. These are not shallow
unit tests — most exercise a whole subsystem against real backends:

- **memory** — remember / recall / dedupe / reindex against an in-memory SQLite DB
- **healing** — real `git` checkpoints, rollback, retry, escalation in temp repos
- **tools** — the two-phase approval flow, single-use tokens, the trash
- **mcp** — install gating (curated + approved), env scrubbing, config generation
- **learning** — `log_failure` → `failures.md` + regression evals + memory
- **skills** — generate → validate → register → reuse
- **ingestion** — stack detection and the code index

Run one file while developing:

```bash
pnpm test:watch                       # all, in watch mode
pnpm exec vitest run packages/core/src/memory   # just the memory tests
```

### 3. Offline smoke — `pnpm smoke`

[`smoke/smoke.ts`](smoke/smoke.ts) imports the **built `dist`** — exactly as a
consumer would — and drives all eight engine subsystems end-to-end in temp
directories. Where `pnpm test` proves the source is correct, the smoke proves
the *packaged build* is correct (exports, entry points, ESM resolution). The
smoke is itself TypeScript: `pnpm smoke` type-checks it (via `tsc --noEmit`)
before running it with `tsx`. No network, no API key.

### 4. Live runtime — `pnpm smoke:live`

[`smoke/live.ts`](smoke/live.ts) makes a **real run against the LLM
provider** — it drives `Runtime.run()` through the Claude Agent SDK and Claude
Opus, and checks a full agent loop completes. It is deliberately separate from
`pnpm test` and `pnpm smoke` because it makes a real model call.

**Authentication.** The Claude Agent SDK authenticates exactly like Claude Code:

- **A Claude.ai Pro/Max subscription** — just be logged into Claude Code on this
  machine. Nothing else to configure; the run is covered by the subscription.
  (The smoke prints a notional `cost` figure regardless — that is the
  API-equivalent estimate, not a charge against a subscription.)
- **Or `ANTHROPIC_API_KEY`** — metered, pay-per-token API billing instead.

```bash
pnpm smoke:live
```

### 5. Live end-to-end build — `pnpm smoke:build`

[`smoke/build.ts`](smoke/build.ts) drives a **full orchestrator build** through
Opus: it plans the task, the agent works step by step through Anvil's MCP tool
bridge (`mcp__anvil__write_file` and friends — raw `Write`/`Edit` are blocked),
and the file actually lands on disk. Same authentication as `smoke:live`. Opt-in.

```bash
pnpm smoke:build
```

This is the proof that Anvil's "tools replace raw access" architecture works end
to end: every write goes through the audit + guardrail layer.

## Coverage — `pnpm test:coverage`

```bash
pnpm test:coverage     # text summary + HTML report in coverage/
```

Coverage measures `packages/*/src` and excludes barrel `index.ts` files and the
still-stub `cli` / `mcp-server` / `service` packages (Milestone C).

Coverage reflects the `pnpm test` run only. Code exercised mainly by the smoke
layers — notably the live `Runtime.run` path, which `pnpm smoke:live` covers —
shows low numbers here even though it is genuinely tested.

## What is and is not covered yet

| Area | Tested by |
| --- | --- |
| `@anvil/core` — all 10 subsystems | `pnpm test` + `pnpm smoke` |
| The live agent loop (`Runtime.run`) | `pnpm smoke:live` |
| `cli` / `mcp-server` / `service` | Stubs — covered in **Milestone C** |
| End-to-end feature builds (task → FE + BE) | The orchestrator — **Milestone B** |

## CI

`.github/workflows/ci.yml` runs install → typecheck → lint → test → smoke on
every push and pull request, on Node 22. The live runtime test is not in CI (it
needs credentials); run it locally with `pnpm smoke:live`.
