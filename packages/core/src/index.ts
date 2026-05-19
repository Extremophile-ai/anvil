/**
 * @anvil/core — the Anvil harness engine.
 *
 * Subsystems are added one module per phase. See ../../docs/architecture.md.
 * Shipped: lib, events, runtime, state, embeddings, memory, healing, tools,
 * mcp, learning.
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

export const ANVIL_CORE_VERSION = "0.0.0";
