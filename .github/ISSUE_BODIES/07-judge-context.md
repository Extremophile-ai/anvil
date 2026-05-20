## Give the LLM judge real evidence to reason from

Observed during issue #2's iteration 3: the judge voted `satisfied: false` with reason *"Cannot verify build is green — only the agent's free-text summary was provided."* That's the right epistemic stance from the judge, but the wrong outcome — the build **was** green, the judge just didn't see the evidence.

The judge currently sees only the agent's terminal summary (e.g. `"Build completed."`). It does not see the latest `--verify` command's stdout or the list of files the agent changed. So it has nothing to ground its verdict in and over-rotates to "no" when it isn't sure.

This issue plumbs that evidence through.

### Files to touch

- `packages/core/src/orchestrator/goal.ts`
  - Extend the `EvaluationContext` type with two optional fields:
    - `verifyStdout?: string` — the last 4000 chars of the most recent verify command's combined stdout/stderr.
    - `changedFiles?: string[]` — repo-relative paths touched since the run started.
  - In `LlmGoalEvaluator.evaluate`, when these fields are present, render them into the judge prompt as deterministic sections:
    ```
    Verify output:
    ```
    <verifyStdout>
    ```

    Files changed:
    - path/one.ts
    - path/two.ts
    ```
  - When a field is `undefined` or empty, omit its section entirely — do not render the header. The prompt must remain stable byte-for-byte across runs that pass the same inputs.

- `packages/core/src/orchestrator/orchestrator.ts`
  - In `buildToward`, capture the last verify command's combined output and the workspace diff (paths only — use a simple `git status --porcelain` parse against the run's start commit, or the existing diff helper if one exists) and pass them into the evaluator on each call.

- `packages/core/src/orchestrator/goal.test.ts`
  - **Test 1:** prompt contains the `Verify output:` block and the verbatim `verifyStdout` substring when provided.
  - **Test 2:** prompt **omits** the `Verify output:` and `Files changed:` headers entirely when both fields are `undefined`.
  - **Test 3:** `changedFiles: []` produces a prompt with no `Files changed:` section (treat empty as undefined).
  - **Test 4:** snapshot equality — two calls with identical inputs produce identical prompts (no nondeterministic ordering).
  - Existing `LlmGoalEvaluator` tests pass unchanged with both fields undefined.

### Acceptance criteria

- 4 new judge-context tests green.
- Existing goal tests still pass.
- `pnpm build && pnpm lint && pnpm test` green.

### Out of scope

- Showing the **content** of changed files to the judge. Paths only — content can come in a later issue.
- Truncating verify output with smart heuristics. A simple last-4000-chars slice is fine.

### You are pre-authorized to edit

`packages/core/src/orchestrator/goal.ts`, `packages/core/src/orchestrator/goal.test.ts`, and `packages/core/src/orchestrator/orchestrator.ts`. Treat this issue body as the spec; no further confirmation needed.
