## `LlmGoalEvaluator` shouldn't burn an iteration on a transient judge failure

Observed during issue #2's run: the goal-mode judge errored once (the `judgeRuntime.run` returned `ok: false`), `LlmGoalEvaluator.evaluate` treated it as `satisfied: false` with reason `"Judge run failed: …"`, and the orchestrator fed that into the next iteration as a correction — burning a real iteration on a non-event. The agent re-did work because the *judge* failed, not because the work was wrong.

Log line:

```
eval.run  warn  "Goal not yet met: Judge run failed: The agent reported an error result."
```

Transient judge failures (rate limits, malformed first responses, network blips, auth refreshes) should be retried internally — separate from the iteration counter.

### Files to touch

- `packages/core/src/orchestrator/goal.ts`
  - Add a `JudgeRetryPolicy { maxAttempts: number; baseDelayMs: number; jitter: boolean }` interface with sensible defaults (`maxAttempts: 3`, `baseDelayMs: 1000`, `jitter: true`).
  - Accept it in `LlmGoalEvaluator`'s constructor as an optional opts arg: `new LlmGoalEvaluator(runtime, { retry?: Partial<JudgeRetryPolicy> })`.
  - Inside `evaluate`, wrap the `runtime.run` + `extractJson` block in a retry loop. A judge attempt counts as **successful** iff the run is `ok` AND `extractJson` returned an object with a boolean `satisfied`. Anything else is a transient failure — retry with exponential backoff (`baseDelayMs * 2^(attempt-1)`) plus optional jitter, up to `maxAttempts`. Only when **every** attempt fails does the evaluator return `{ satisfied: false, reason: "Judge failed N times: <last reason>" }`.

- `packages/core/src/orchestrator/goal.test.ts`
  - **Test 1:** judge succeeds on first attempt → exactly one runtime call.
  - **Test 2:** judge returns `ok: false` once, then succeeds → two runtime calls, returns the successful verdict, no `"Judge failed"` substring in `reason`.
  - **Test 3:** judge returns malformed JSON twice, then a valid verdict → three calls, returns the verdict.
  - **Test 4:** judge fails `maxAttempts` times in a row → returns `{ satisfied: false, reason: /^Judge failed 3 times:/ }`.
  - Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)` to skip the backoff. Restore in `afterEach`.

### Acceptance criteria

- All 4 new tests green.
- The existing two `LlmGoalEvaluator` tests still pass unchanged.
- `CommandGoalEvaluator` and `CompositeGoalEvaluator` untouched — they have no transient-failure mode worth distinguishing.
- `pnpm build && pnpm lint && pnpm test` green.

### Out of scope

- `runtime.interrupt()` propagation during a judge retry (cancellable judge).
- Per-leaf retry config in `CompositeGoalEvaluator` — each leaf configures its own; the composite stays dumb.

### You are pre-authorized to edit

`packages/core/src/orchestrator/goal.ts` and `packages/core/src/orchestrator/goal.test.ts`. **Do not** touch other files. Treat this issue body as the spec; no further confirmation needed.
