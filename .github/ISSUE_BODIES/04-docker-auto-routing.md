## Orchestrator routes flagged nodes through the Docker sandbox

The Docker sandbox client exists (`packages/core/src/sandbox/*`), but the orchestrator always calls `runtime.run` directly. We want a simple opt-in: if a node says "I'm risky, sandbox me" — or if the whole run is sandboxed via env — the orchestrator routes that node's execution through the existing Docker client instead.

### Files to touch

- `packages/core/src/orchestrator/orchestrator.ts`
  - For each node, before invoking `runtime.run`, decide the execution path:
    - **Docker** when `node.metadata?.sandbox === "docker"` **OR** `process.env.ANVIL_SANDBOX === "docker"`.
    - **Direct** otherwise.
  - The Docker path must forward the same inputs the direct path forwards (the prompt built by `buildNodePrompt`, the workspace `cwd`, the available `tools`) and must surface the resulting shape as the same `Result` the direct path returns. Errors from the sandbox client surface as `{ ok: false, error: <message> }` on that node's result — the run continues; no throw.

- `packages/shared/src/plan.ts` (only if needed)
  - Ensure `PlanNode` has an optional `metadata?: Record<string, unknown>` field (or a typed `metadata?: { sandbox?: "docker" | "direct" }`). If a similar field already exists, reuse it.

- `packages/core/src/orchestrator/orchestrator.sandbox.test.ts` (new file)
  - **Test 1:** Normal node → the stub direct runtime is called once; the stub sandbox client is **not** called.
  - **Test 2:** Node with `metadata.sandbox === "docker"` → the stub sandbox client is called once with the same prompt as the direct path would receive; the direct runtime is **not** called.
  - **Test 3:** `ANVIL_SANDBOX=docker` set via `vi.stubEnv` → every node is routed through the sandbox client.
  - **Test 4:** Sandbox client throws → that node's `Result` is `{ ok: false, error: /.../ }`; subsequent nodes still execute.

### Acceptance criteria

- 4 new tests green.
- Existing orchestrator tests still pass unchanged (the direct path is the default).
- `pnpm build && pnpm lint && pnpm test` green.

### Out of scope

- Building / pulling Docker images here. Assume the sandbox client's `run` method exists and is mockable.
- Per-tool sandboxing inside a single node — node-level routing is enough.

### You are pre-authorized to edit

`packages/core/src/orchestrator/orchestrator.ts`, the new `orchestrator.sandbox.test.ts`, and `packages/shared/src/plan.ts` **only if the metadata field is missing**. Treat this issue body as the spec; no further confirmation needed.
