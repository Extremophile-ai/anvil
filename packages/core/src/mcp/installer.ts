/**
 * The MCP installer. It turns a vetted catalog spec into an installed record,
 * and an installed record into the sandboxed config the runtime hands the SDK.
 *
 * Sandboxing here means least privilege at the process boundary: an MCP server
 * receives only the environment variables it explicitly declared, never the
 * harness's full environment.
 */
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { AnvilError } from "../lib/errors.js";
import { runCommand } from "../lib/exec.js";
import type { McpServerRecord, McpServerSpec } from "./types.js";

export interface InstallOptions {
  /** Values for the server's declared `envKeys`. */
  env?: Record<string, string>;
  /** Pre-fetch the npm package now instead of on first run. */
  prefetch?: boolean;
  cwd?: string;
}

export class McpInstaller {
  /** Install a server: optionally prefetch its package, then record it. */
  async install(spec: McpServerSpec, options: InstallOptions = {}): Promise<McpServerRecord> {
    if (options.prefetch && spec.package) {
      const result = await runCommand("npm", ["install", "--no-save", spec.package], {
        cwd: options.cwd ?? process.cwd(),
        timeoutMs: 120_000,
      });
      if (result.code !== 0) {
        throw new AnvilError("MCP_ERROR", `Failed to prefetch "${spec.package}": ${result.stderr.trim()}`);
      }
    }
    return {
      ...spec,
      env: this.scrubEnv(spec, options.env ?? {}),
      enabled: true,
      installedAt: new Date().toISOString(),
    };
  }

  /** Build the SDK server config — with only the declared env variables. */
  toConfig(record: McpServerRecord): McpServerConfig {
    if (record.transport === "http") {
      if (!record.url) throw new AnvilError("MCP_ERROR", `MCP server "${record.id}" has no URL.`);
      return { type: "http", url: record.url };
    }
    if (record.transport === "sse") {
      if (!record.url) throw new AnvilError("MCP_ERROR", `MCP server "${record.id}" has no URL.`);
      return { type: "sse", url: record.url };
    }
    if (!record.command) {
      throw new AnvilError("MCP_ERROR", `MCP server "${record.id}" has no command.`);
    }
    return {
      type: "stdio",
      command: record.command,
      args: record.args ?? [],
      env: record.env,
    };
  }

  /** Keep only the env variables the server declared it needs. */
  private scrubEnv(spec: McpServerSpec, supplied: Record<string, string>): Record<string, string> {
    const allowed = new Set(spec.envKeys ?? []);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(supplied)) {
      if (allowed.has(key)) env[key] = value;
    }
    return env;
  }
}
