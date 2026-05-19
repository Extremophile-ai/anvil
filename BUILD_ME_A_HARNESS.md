# Build Me an Agent Harness

## What is a harness?

An agent harness is everything outside the LLM that turns it from a token generator into a reliable, domain-aware agent. It is NOT a collection of markdown rules or prompt instructions — it is executable infrastructure that the agent calls as tools.

The core principle: **every time the agent makes a mistake, you engineer a permanent fix into the harness so that mistake becomes structurally impossible to repeat.** A prompt rule says "don't delete production files." A harness tool physically cannot delete production files because delete was never implemented.

The formula: **Agent = Model + Harness**

The harness compounds. Every fix applies to every future session, with every future model. Model upgrades reset raw intelligence. Harness investment never resets.

---

## What I need you to build

A TypeScript MCP (Model Context Protocol) server that acts as my agent harness. It exposes domain-specific tools that Claude Code calls instead of running raw bash commands or touching the filesystem directly.

### Tech stack for the harness

- Runtime: Node.js 20+
- Language: TypeScript (strict mode)
- MCP SDK: `@modelcontextprotocol/sdk` (latest)
- Transport: stdio
- Validation: `zod` for input schemas
- Dev runner: `tsx`
- No other frameworks — keep it thin

---

## Step 1 — Interview me

Before writing any code, you need to understand my project deeply. Ask me about:

1. **Workspace structure** — what repos/folders exist, what each one does, what the tech stack is per repo
2. **Dangerous operations** — what actions, if done wrong, would ruin my day (deleting files, pushing to main, changing database schemas, modifying auth, editing configs)
3. **Repeated mistakes** — where does the agent currently waste my time or make errors (wrong file locations, duplicate code, wrong conventions, breaking APIs)
4. **Cross-boundary work** — do repos depend on each other? Are there contracts between them (API shapes, shared types, design systems)?
5. **Package management** — what package manager, any special flags, any repos with quirks
6. **Approval preferences** — what must always require my explicit approval vs what can run freely

Ask these questions one at a time. Do not proceed until you have clear answers for all six.

---

## Step 2 — Design the tool layer

Based on my answers, design the specific tools my harness needs. Every tool must follow these principles:

### Tool design principles

1. **Tools replace raw access, not supplement it.** If a tool exists for an operation, the agent must never do that operation via bash or direct filesystem access. The tool IS the only way.

2. **Read-only tools need no approval. Write tools need previews.** Any tool that reads data (listing files, checking contracts, finding components) should run freely. Any tool that changes state (creating files, moving files, installing packages) must implement the two-phase approval pattern:
   - Phase 1: Tool returns a preview of exactly what it will do
   - Phase 2: User approves → tool executes with a confirmation token
   - The tool physically cannot execute without a valid, unexpired token

3. **Every tool logs every call.** A structured JSONL log file records: timestamp, tool name, inputs, result. This is the audit trail and the source data for harness improvement.

4. **Error messages must be actionable.** Never return "error occurred." Always return "Component EventCard already exists at src/components/ui/EventCard/. Use list_components to see what exists."

5. **Tools enforce boundaries mechanically.** Path traversal guards, repo boundary enforcement, contract validation — these are code checks, not prompt instructions.

### Categories of tools to consider

Based on what you learn about my project, design tools from these categories:

- **Scaffolding tools** — create files, components, modules in the correct location with the correct structure. Prevents the agent from guessing conventions.
- **Discovery tools** — find existing files, list components, show project structure. Prevents duplicates and wrong assumptions.
- **Contract tools** — read and validate API contracts, shared types, or interface boundaries between repos. Prevents breaking changes.
- **Cross-boundary tools** — controlled access to reference repos, legacy code, or shared resources. Everything logged.
- **File operation tools** — move/rename with automatic import updates. Replaces raw mv/cp/rm.
- **Package tools** — wraps the package manager with repo-specific flags and approval gates.
- **Learning tools** — a `log_failure` tool that records mistakes, root causes, and harness improvements needed.

You don't need all categories. Design only what my project actually needs based on the interview.

---

## Step 3 — Build it

### Project structure

```
harness/
  src/
    tools/           ← one file per tool category
    lib/
      approval.ts    ← two-phase approval utility
      workspace.ts   ← path resolution for all repos
      logger.ts      ← structured JSONL logging
    index.ts         ← MCP server entry point
    registry.ts      ← imports and registers all tools
  logs/              ← auto-created at runtime, gitignored
  failures.md        ← learning log, committed to git
  package.json
  tsconfig.json
```

### Build order

Follow this exact order to ship incrementally and catch issues early:

1. `lib/workspace.ts` — everything depends on path resolution
2. `lib/logger.ts` — everything logs
3. `lib/approval.ts` — needed by write tools
4. `index.ts` + `registry.ts` — empty server shell
5. **Stop. Verify the server starts without errors.**
6. Build tools one file at a time, starting with the highest-value one
7. After each tool file, register it and verify it appears in `/tools`
8. Continue until all tools are built

### For each tool, specify:

- Name (snake_case)
- Purpose (one sentence)
- Input schema (with zod types)
- Exact behaviour (numbered steps)
- Whether it requires approval
- What it logs
- What it returns (TypeScript type)

### Conventions

- Tool names: snake_case
- Zod schemas: `.strict()` on all objects
- All paths validated against workspace root (no traversal)
- No tool deletes files — moves to a trash folder instead
- Each tool file under 200 lines — split if larger
- Server logs to stderr (stdout reserved for MCP protocol)

---

## Step 4 — Register with Claude Code

Create `.mcp.json` at the workspace root:

```json
{
  "mcpServers": {
    "<project>-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["harness/dist/index.js"],
      "cwd": "<absolute-path-to-workspace>"
    }
  }
}
```

---

## Step 5 — Update project memory

After the harness is running, add a tool reference section to CLAUDE.md (or equivalent) that:

1. Lists every available tool and when to use it
2. States explicitly: "Never use raw bash for X — use tool Y instead"
3. States: "Always call `log_failure` after any mistake is corrected"

---

## Step 6 — Create the learning log

Create `harness/failures.md` — the institutional memory. The `log_failure` tool appends entries with: what happened, root cause, fix applied, harness improvement needed, severity.

After 10-15 entries, review the log. Patterns will tell you exactly which tools to build next.

---

## Verification checklist

After building, verify inside Claude Code:

- [ ] `/tools` lists all harness tools
- [ ] Read-only tools work without approval
- [ ] Write tools show a preview and wait for confirmation
- [ ] Approval tokens expire (test by waiting)
- [ ] Path traversal is rejected
- [ ] All calls appear in `logs/harness.log`
- [ ] `log_failure` appends to `failures.md`
- [ ] The agent uses harness tools instead of raw bash for covered operations
