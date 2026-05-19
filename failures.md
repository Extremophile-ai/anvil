# Failures Log — Anvil's Institutional Memory

This file is the durable record of every mistake Anvil makes and the structural
fix engineered in response. It is committed to git on purpose: it is the source
data for harness improvement.

The `log_failure` tool (Phase 7) appends entries here automatically whenever a
mistake is corrected. The learning loop reviews this log, distils patterns into
memory facts and evals, and tells the skill factory which guardrail tools to
build next.

## Entry format

Each entry records:

- **What happened** — the observable mistake.
- **Root cause** — why it happened, not just what.
- **Fix applied** — the immediate correction in this session.
- **Harness improvement** — the permanent, structural change that makes the
  mistake impossible to repeat (a new tool, a guardrail, a schema constraint).
- **Severity** — `low` | `medium` | `high` | `critical`.

After every 10–15 entries, review the log: the patterns name the next tools to build.

---

<!-- Entries are appended below this line by the log_failure tool. -->
