/**
 * The MCP manager — tracks installed MCP servers, matches a needed capability
 * to a curated server, and gates every install behind two checks: the server
 * must be in the curated registry, and the install must be approved.
 */
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { JobId } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import { AnvilError } from "../lib/errors.js";
import type { StateStore } from "../state/store.js";
import { McpInstaller } from "./installer.js";
import { McpRegistry } from "./registry.js";
import type { McpInstallProposal, McpServerRecord, McpServerSpec, McpTransport } from "./types.js";

export interface McpManagerDeps {
  store: StateStore;
  registry?: McpRegistry;
  installer?: McpInstaller;
  bus?: EventBus;
}

export interface InstallApproval {
  approved: boolean;
  env?: Record<string, string>;
  jobId?: JobId;
}

function parseList(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseMap(value: unknown): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    }
    return {};
  } catch {
    return {};
  }
}

function rowToRecord(row: Record<string, unknown>): McpServerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    transport: String(row.transport) as McpTransport,
    command: row.command == null ? undefined : String(row.command),
    args: parseList(row.args),
    url: row.url == null ? undefined : String(row.url),
    package: row.package == null ? undefined : String(row.package),
    capabilities: parseList(row.capabilities),
    envKeys: parseList(row.env_keys),
    homepage: row.homepage == null ? undefined : String(row.homepage),
    env: parseMap(row.env),
    enabled: Number(row.enabled) === 1,
    installedAt: String(row.installed_at),
  };
}

export class McpManager {
  private readonly store: StateStore;
  private readonly registry: McpRegistry;
  private readonly installer: McpInstaller;
  private readonly bus: EventBus | undefined;

  constructor(deps: McpManagerDeps) {
    this.store = deps.store;
    this.registry = deps.registry ?? new McpRegistry();
    this.installer = deps.installer ?? new McpInstaller();
    this.bus = deps.bus;
  }

  /** Curated servers that match a capability the harness needs. */
  discover(capability: string): McpServerSpec[] {
    return this.registry.search(capability);
  }

  /** Produce an install proposal for human review. */
  proposeInstall(specOrId: McpServerSpec | string): McpInstallProposal {
    const spec = this.resolve(specOrId);
    const curated = this.registry.has(spec.id);
    return {
      spec,
      summary: `Install the "${spec.name}" MCP server (${spec.transport}) — ${spec.description}`,
      requiresEnv: spec.envKeys ?? [],
      curated,
    };
  }

  /** Install a server. Gated: it must be curated AND the install approved. */
  async install(specOrId: McpServerSpec | string, approval: InstallApproval): Promise<McpServerRecord> {
    const spec = this.resolve(specOrId);
    if (!this.registry.has(spec.id)) {
      throw new AnvilError(
        "MCP_NOT_APPROVED",
        `"${spec.id}" is not in the curated MCP registry. Anvil only installs vetted servers.`,
      );
    }
    if (!approval.approved) {
      throw new AnvilError(
        "MCP_NOT_APPROVED",
        `Installing the "${spec.id}" MCP server requires explicit approval.`,
      );
    }
    const record = await this.installer.install(spec, { env: approval.env });
    this.persist(record);
    if (this.bus && approval.jobId) {
      this.bus.publish(approval.jobId, "mcp.installed", "info", `Installed MCP server "${spec.name}".`, {
        id: spec.id,
      });
    }
    return record;
  }

  list(): McpServerRecord[] {
    const rows = this.store.db.prepare("SELECT * FROM mcp_servers ORDER BY installed_at").all() as Array<
      Record<string, unknown>
    >;
    return rows.map(rowToRecord);
  }

  get(id: string): McpServerRecord | undefined {
    const row = this.store.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.store.db
      .prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
  }

  remove(id: string): boolean {
    const result = this.store.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  /** The `Record<string, McpServerConfig>` to hand the runtime. */
  configs(): Record<string, McpServerConfig> {
    const configs: Record<string, McpServerConfig> = {};
    for (const record of this.list()) {
      if (record.enabled) configs[record.id] = this.installer.toConfig(record);
    }
    return configs;
  }

  private resolve(specOrId: McpServerSpec | string): McpServerSpec {
    if (typeof specOrId !== "string") return specOrId;
    const spec = this.registry.get(specOrId);
    if (!spec) {
      throw new AnvilError("MCP_ERROR", `Unknown MCP server "${specOrId}". Search the registry first.`);
    }
    return spec;
  }

  private persist(record: McpServerRecord): void {
    this.store.db
      .prepare(
        `INSERT INTO mcp_servers
           (id, name, description, transport, command, args, url, package,
            capabilities, env, env_keys, homepage, enabled, installed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, description = excluded.description,
           transport = excluded.transport, command = excluded.command, args = excluded.args,
           url = excluded.url, package = excluded.package, capabilities = excluded.capabilities,
           env = excluded.env, env_keys = excluded.env_keys, homepage = excluded.homepage,
           enabled = excluded.enabled`,
      )
      .run(
        record.id,
        record.name,
        record.description,
        record.transport,
        record.command ?? null,
        JSON.stringify(record.args ?? []),
        record.url ?? null,
        record.package ?? null,
        JSON.stringify(record.capabilities),
        JSON.stringify(record.env),
        JSON.stringify(record.envKeys ?? []),
        record.homepage ?? null,
        record.enabled ? 1 : 0,
        record.installedAt,
      );
  }
}
