/**
 * Types for the MCP manager — the catalog spec for an MCP server, the record
 * of an installed one, and the proposal a human approves before an install.
 */

export type McpTransport = "stdio" | "http" | "sse";

/** A curated catalog entry describing an MCP server Anvil may install. */
export interface McpServerSpec {
  /** Stable id, e.g. "filesystem", "github". */
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  /** For stdio servers — the command and its arguments. */
  command?: string;
  args?: string[];
  /** For http/sse servers — the endpoint URL. */
  url?: string;
  /** The npm package, when the server is published as one. */
  package?: string;
  /** Capability tags used to match a server to a need. */
  capabilities: string[];
  homepage?: string;
  /** Names of environment variables the server needs to function. */
  envKeys?: string[];
}

/** An MCP server that has been installed and is tracked by the manager. */
export interface McpServerRecord extends McpServerSpec {
  /** Values for the server's `envKeys`, supplied at install time. */
  env: Record<string, string>;
  enabled: boolean;
  installedAt: string;
}

/** What a human sees before approving an install. */
export interface McpInstallProposal {
  spec: McpServerSpec;
  summary: string;
  /** Environment variables the operator must supply for the server to work. */
  requiresEnv: string[];
  /** True when the server comes from the curated registry. */
  curated: boolean;
}
