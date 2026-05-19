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

✅ **Milestones A and B are complete.** The harness core (runtime, state,
hybrid memory, self-healing, tools, MCP manager, learning loop, skill factory,
workspace ingestion) plus the end-to-end build engine (plan DAG, JobStore,
heuristic + LLM planner, local/Docker sandbox, delivery via feature-branch and
`gh`, and the orchestrator that wires them) — 97 unit tests and 9 offline
smoke phases, all green.

Next: **Milestone C** hardens the CLI, MCP server, and HTTP service over the
core engine. See [docs/architecture.md](docs/architecture.md).

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
pnpm lint         # eslint
pnpm test         # vitest — unit + integration
pnpm smoke        # end-to-end smoke against the built dist
```

Requires Node.js 22+ and pnpm 10+. See [TESTING.md](TESTING.md) for the full
testing guide, including the live runtime test and coverage.

## License

MIT — see [LICENSE](LICENSE).
