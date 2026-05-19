/**
 * @anvil/core — the Anvil harness engine.
 *
 * Phase 1: scaffold only. Subsystems are added one module per phase — each
 * landing under src/ as it is built. See ../../docs/architecture.md §5 and §9.
 *
 * Planned modules:
 *   runtime/      agent loop (Claude Agent SDK + Opus) + steering channel
 *   orchestrator/ plan DAG + frontend/backend task scheduling
 *   memory/       markdown file layer + local vector index + manager
 *   learning/     reflection post-mortems + eval suite + log_failure
 *   healing/      git checkpoints + runtime recovery + retry/escalation
 *   mcp/          MCP client + curated registry + sandboxed installs
 *   skills/       self-extension factory + global library
 *   ingestion/    stack detection + project profile + code indexing
 *   sandbox/      Docker per-task lifecycle (Compose for multi-service)
 *   git/          feature branches + checkpoints + pull requests
 *   tools/        the tool layer (two-phase approval, JSONL logging)
 *   state/        the SQLite store
 *   events/       event bus + structured JSONL logging
 *   lib/          approval.ts, workspace.ts, logger.ts
 */

export const ANVIL_CORE_VERSION = "0.0.0";
