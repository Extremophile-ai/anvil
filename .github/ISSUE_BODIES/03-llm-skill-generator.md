## LLM-backed `SkillGenerator`

Today `SkillGenerator.generate()` (in `packages/core/src/skills/generator.ts`) returns template stubs — useful for tests, useless for actually shipping new skills from the orchestrator. We need a real LLM-driven implementation behind an env flag, with the existing template path as the default fallback so unit tests stay deterministic.

### Files to touch

- `packages/core/src/skills/generator.ts`
  - Keep the existing class (rename it `HeuristicSkillGenerator` if needed).
  - Add a new `LlmSkillGenerator` that takes a `Runtime` (a small Haiku runtime — `model` overridable via `ANVIL_SKILL_GENERATOR_MODEL`, default `"haiku"`; `maxTurns: 3`, `permissionMode: "bypassPermissions"`, `settingSources: []`) and on `generate({ name, description, capabilities })` issues exactly one `runtime.run` whose prompt explicitly mentions the requested capabilities and asks the model to return a JSON object `{ files: { [path]: contents } }`.
  - Parse the model's JSON via the existing `extractJson` helper (in `packages/core/src/orchestrator/planner.ts`). On parse failure, return `{ files: {} }` and log a warning to `stderr` — never throw.
  - Export `selectSkillGeneratorFromEnv({ bus, cwd })` mirroring the shape of `selectPlannerFromEnv` in `packages/core/src/orchestrator/planner.ts`. `ANVIL_SKILL_GENERATOR=llm` returns the LLM generator; empty/unset returns the heuristic; any other value writes `'anvil: unknown ANVIL_SKILL_GENERATOR value "<value>", falling back to HeuristicSkillGenerator\n'` to stderr once and returns the heuristic.

- `packages/core/src/skills/generator.test.ts` (create if absent)
  - **Test 1:** `ANVIL_SKILL_GENERATOR` unset → `selectSkillGeneratorFromEnv` returns the heuristic; existing skill tests untouched.
  - **Test 2:** `ANVIL_SKILL_GENERATOR=llm` → returns the `LlmSkillGenerator`; with a stub runtime, `generate({name, description, capabilities:["http"]})` calls `runtime.run` exactly once and the captured prompt contains the substring `"http"`.
  - **Test 3:** stub runtime returns malformed JSON → `generate` resolves to `{ files: {} }`, does not throw, and writes one warning line to stderr (assert via `vi.spyOn(process.stderr, "write")`).
  - **Test 4:** unrecognized env value → warning on stderr matches the exact format above, falls back to heuristic.

### Acceptance criteria

- The 4 new tests are green.
- The existing `factory.test.ts` and any other skill tests still pass unchanged.
- `pnpm build && pnpm lint && pnpm test` green.

### Out of scope

- Auto-registering the generated files as new skills on disk — that's a separate plumbing change in `factory.ts` and can land later.
- Streaming the model output. One `runtime.run` is fine.

### You are pre-authorized to edit

`packages/core/src/skills/generator.ts`, `packages/core/src/skills/generator.test.ts`, and any minimal re-exports needed in `packages/core/src/skills/index.ts`. **Do not** touch other files. Treat this issue body as the spec; you do not need further confirmation before making the listed edits.
