#!/usr/bin/env node
/**
 * @anvil/mcp-server — exposes the Anvil harness over MCP (stdio transport).
 *
 * This package is kept deliberately thin: just the MCP SDK + zod. All real
 * work is delegated to @anvil/core. The MCP tools (build_feature, get_status,
 * inject_correction, approve_step, …) land in Milestone C.
 *
 * The server logs to stderr — stdout is reserved for the MCP protocol.
 */

function main(): void {
  console.error("anvil-mcp v0.0.0 — scaffold (Phase 1). MCP tools land in Milestone C.");
}

main();
