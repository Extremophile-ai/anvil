## `SkillLibrary` must validate skills it reads, not just skills it generates

Today `validateSkill` is only invoked in `packages/core/src/skills/factory.ts:53` — i.e. on the *generation* path. `SkillLibrary.get()` (in `packages/core/src/skills/library.ts`) reads a `.skill.md` from `~/.anvil/skills/` and returns it without re-validating. So if a user hand-edits a skill file, drops in a third-party one, or syncs the directory across machines, an invalid or malformed skill flows straight into the orchestrator's prompt — silently.

This issue closes that gap: every skill we *read from disk* gets validated on read; invalid ones are skipped (with a warning), not returned.

### Files to touch

- `packages/core/src/skills/library.ts`
  - In `get(name)`: after constructing the `Skill` from frontmatter+body, run `validateSkill(skill)` (treating the read skill as a `SkillDraft` — the shape is identical for the fields validate cares about). If `validation.ok === false`, write one warning line to `stderr` in the exact format `'anvil: skipping invalid skill "<name>": <issue1>; <issue2>\n'`, and return `undefined`.
  - In `list()`: it already filters out `undefined` results, so the warning + skip behavior composes naturally — but make sure validation runs **once per skill**, not twice. Don't change the `search()` API.
  - Re-export `validateSkill` from `packages/core/src/skills/index.ts` if it isn't already exported there.

- `packages/core/src/skills/library.test.ts`
  - **Test 1:** Saving a valid skill and then `get(name)` returns it unchanged (regression — existing behavior).
  - **Test 2:** Hand-writing an invalid skill file (e.g. empty `description`, no capabilities) into the library dir and calling `get(name)` returns `undefined` and writes one warning to stderr matching `/anvil: skipping invalid skill/`.
  - **Test 3:** `list()` over a directory containing 1 valid + 1 invalid skill returns an array of length 1 (the valid one) and writes exactly one warning to stderr.
  - **Test 4:** A `.skill.md` file with corrupt/missing frontmatter is skipped without crashing (returns `undefined`, no exception bubbles up).
  - Use `vi.spyOn(process.stderr, "write")` and a temp dir via `mkdtempSync(join(tmpdir(), "anvil-skills-"))` so the tests don't touch `~/.anvil/skills/`. Clean up with `rmSync(..., { recursive: true, force: true })` in `afterEach`.

### Acceptance criteria

- 4 new tests green.
- `factory.test.ts` still passes — the generation path is untouched.
- `pnpm build && pnpm lint && pnpm test` green.

### Out of scope

- A CLI subcommand to bulk-validate the entire library (could come later as `anvil skills doctor`).
- Recovering or auto-fixing broken skill files. Skip-with-warning is enough.

### You are pre-authorized to edit

`packages/core/src/skills/library.ts`, `packages/core/src/skills/library.test.ts`, and `packages/core/src/skills/index.ts` **only** for re-exports. Treat this issue body as the spec; no further confirmation needed.
