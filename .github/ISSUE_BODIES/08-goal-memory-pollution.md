## Stop persisting failed-goal facts to memory — they're being recalled as guidance

Observed after a few dogfood runs: `anvil memory list` shows accumulating `goal-<id>` and `post-mortem-<id>` facts. Their bodies contain raw lines like:

```
Achieved: false
status: failed
reason: Cannot verify build is green
```

Those facts get recalled into *subsequent* runs' node prompts as if they were guidance, and the next agent reads "achieved: false, status: failed" and second-guesses work that is in fact fine. Worse, the noise crowds out useful learnings.

We want two things:

1. **Don't write a fact on a failed run.** A failed goal is an event, not a lesson.
2. **Tag successful-run facts** so the default recall path ignores them. They become opt-in (e.g. a future "retro" view), not opt-out.

### Files to touch

- `packages/core/src/orchestrator/orchestrator.ts` (and/or wherever `buildToward` lives)
  - Find the call site(s) that currently persist `goal-*` and `post-mortem-*` facts on every run. **Remove the unconditional write.**
  - When the goal terminates with `satisfied: true`, persist exactly **one** fact:
    - Name: `goal-<id>` (or `post-mortem-<id>` if that's the existing convention).
    - Body: the post-mortem summary (keep current shape).
    - Tag/kind: a new value `"learning"` (add to the existing `MemoryKind` union if it isn't already there).

- `packages/core/src/memory/store.ts` (or wherever `MemoryStore.recall` lives)
  - Add an optional `MemoryRecallOptions { includeKinds?: MemoryKind[] }` parameter to `recall`.
  - **Default behavior:** `recall` excludes facts whose kind is `"learning"`.
  - When the caller passes `includeKinds: ["learning"]`, those facts are returned (in addition to whatever the default would return).
  - Do not change the on-disk format beyond adding the new kind value.

- `packages/core/src/orchestrator/orchestrator.memory.test.ts` (new file)
  - **Test 1:** Run an orchestrator with a stub evaluator that returns `satisfied: false`. After the run, the store has **zero** new facts.
  - **Test 2:** Run with a stub evaluator returning `satisfied: true`. After the run, the store has **exactly one** new fact, tagged `"learning"`.
  - **Test 3:** `MemoryStore.recall(query)` with no options excludes the learning-tagged fact.
  - **Test 4:** `MemoryStore.recall(query, { includeKinds: ["learning"] })` returns it.

- `packages/core/src/memory/store.test.ts` (extend if it exists)
  - Add one focused test for the default-exclude / opt-in-include behavior on `recall`, so memory-layer regressions surface independently of the orchestrator.

### Acceptance criteria

- All new tests green.
- Existing orchestrator and memory tests still pass — the change is purely additive on the API surface and net-negative on the default recall set.
- `pnpm build && pnpm lint && pnpm test` green.

### Out of scope

- Migrating or deleting the *existing* polluted `goal-*` facts on disk. Cleanup is a separate one-shot script.
- A CLI surface for filtering recall by kind. Stay in core; CLI can come later.

### You are pre-authorized to edit

`packages/core/src/orchestrator/orchestrator.ts`, the new `orchestrator.memory.test.ts`, `packages/core/src/memory/store.ts`, `packages/core/src/memory/store.test.ts`, and `packages/shared/src/memory.ts` **only if** the `MemoryKind` union needs the `"learning"` value added. Treat this issue body as the spec; no further confirmation needed.
