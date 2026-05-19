/**
 * @anvil/core — the Anvil harness engine.
 *
 * Subsystems are added one module per phase. See ../../docs/architecture.md.
 * Shipped: lib, events, runtime, state, embeddings, memory, healing, tools,
 * mcp, learning, skills, ingestion, orchestrator, sandbox, delivery.
 */
export * from "./lib/index.js";
export * from "./events/index.js";
export * from "./runtime/index.js";
export * from "./state/index.js";
export * from "./embeddings/index.js";
export * from "./memory/index.js";
export * from "./healing/index.js";
export * from "./tools/index.js";
export * from "./mcp/index.js";
export * from "./learning/index.js";
export * from "./skills/index.js";
export * from "./ingestion/index.js";
export * from "./orchestrator/index.js";
export * from "./sandbox/index.js";
export * from "./delivery/index.js";
export * from "./service.js";

export const ANVIL_CORE_VERSION = "0.0.0";
