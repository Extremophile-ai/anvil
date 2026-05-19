# Anvil

**An autonomous, self-healing, self-learning coding harness.**

> Agent = Model + Harness. The model resets with every upgrade. The harness compounds forever.

Anvil takes a task — a product or a feature — and builds it end to end (frontend
through backend microservices), using every tool and resource available to it.
It steers in real time, learns from your corrections, heals itself when things
break, and extends itself with new tools, skills, and MCP servers as it needs them.

Anvil plugs into **any** project: point it at a workspace, it ingests the repo
and builds the tooling that workspace needs.

## Status

✅ **Milestone A — the harness core — is complete.** All ten `@anvil/core`
subsystems build, lint, and test green (64 unit tests, plus an integration
smoke per phase): runtime, state, hybrid memory, self-healing, the tool layer,
the MCP manager, the learning loop, the skill factory, and workspace ingestion.

Next: **Milestone B** wires these into the end-to-end build orchestrator;
**Milestone C** hardens the CLI, MCP server, and HTTP service. See
[docs/architecture.md](docs/architecture.md).

## Core idea

A harness is **not** a pile of prompt rules — it is executable infrastructure the
agent calls as tools. Every time the agent makes a mistake, the fix is engineered
into the harness so that mistake becomes *structurally impossible* to repeat. A
prompt rule says "don't delete production files"; a harness tool simply never
implements delete. Every fix applies to every future session, with every future
model.

## How it works

- **Brain** — Claude Opus, driven through the Claude Agent SDK.
- **Invokable anywhere** — exposed over MCP, so Claude Code, Codex, Gemini, or
  Cursor can all call it; also a standalone CLI and an HTTP service.
- **Real-time steerable** — corrections inject mid-task and feed the learning loop.
- **Hybrid memory** — human-readable markdown facts plus a local vector index.
- **Self-healing** — test-driven repair, runtime recovery, git checkpoint
  rollback, and escalation when genuinely stuck.
- **Self-extending** — generates tools, skills, and plugins; installs new MCP
  servers from a curated registry, sandboxed, with one-click approval.
- **Local-first** — SQLite plus local vectors; no cloud dependency to run.

## Packages

| Package              | Role                                                       |
| -------------------- | ---------------------------------------------------------- |
| `@anvil/shared`      | Shared types and zod schemas                               |
| `@anvil/core`        | The harness engine (runtime, memory, learning, healing, …) |
| `@anvil/cli`         | The `anvil` command-line interface                         |
| `@anvil/mcp-server`  | Exposes the harness over MCP (stdio)                       |
| `@anvil/service`     | HTTP + queue daemon for long-running async builds          |

## Develop

```bash
pnpm install      # install workspace dependencies
pnpm build        # build all packages (tsc project references)
pnpm typecheck    # type-check the whole monorepo
pnpm lint         # eslint
pnpm test         # vitest
```

Requires Node.js 20+ and pnpm 10+.

## License

MIT — see [LICENSE](LICENSE).
