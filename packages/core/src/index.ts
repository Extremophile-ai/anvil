/**
 * @anvil/core — the Anvil harness engine.
 *
 * Subsystems are added one module per phase. See ../../docs/architecture.md.
 * Shipped: lib (errors, logging, workspace), events, runtime.
 */
export * from "./lib/index.js";
export * from "./events/index.js";
export * from "./runtime/index.js";

export const ANVIL_CORE_VERSION = "0.0.0";
