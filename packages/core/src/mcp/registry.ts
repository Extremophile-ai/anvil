/**
 * The curated MCP registry — the vetted catalog of servers Anvil is allowed to
 * install. Nothing outside this catalog is installable; that is the supply-
 * chain boundary. The catalog can be extended from a JSON file.
 */
import { existsSync, readFileSync } from "node:fs";
import { AnvilError } from "../lib/errors.js";
import type { McpServerSpec } from "./types.js";

/** The built-in, vetted catalog of well-known MCP servers. */
export const DEFAULT_MCP_REGISTRY: readonly McpServerSpec[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files within allowed directories.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    package: "@modelcontextprotocol/server-filesystem",
    capabilities: ["filesystem", "files", "read", "write"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "memory",
    name: "Knowledge Graph Memory",
    description: "A persistent knowledge-graph memory for the agent.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    package: "@modelcontextprotocol/server-memory",
    capabilities: ["memory", "knowledge-graph", "notes"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Structured step-by-step reasoning for hard problems.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    package: "@modelcontextprotocol/server-sequential-thinking",
    capabilities: ["reasoning", "planning", "thinking"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch web pages and convert them to markdown.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    package: "@modelcontextprotocol/server-fetch",
    capabilities: ["web", "fetch", "http", "scraping"],
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Work with GitHub repositories, issues, and pull requests.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    package: "@modelcontextprotocol/server-github",
    capabilities: ["github", "git", "issues", "pull-requests", "vcs"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Drive a real browser for end-to-end testing and scraping.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    package: "@playwright/mcp",
    capabilities: ["browser", "playwright", "e2e", "testing", "web"],
    homepage: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query and inspect PostgreSQL databases.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    package: "@modelcontextprotocol/server-postgres",
    capabilities: ["database", "postgres", "sql"],
    homepage: "https://github.com/modelcontextprotocol/servers",
    envKeys: ["POSTGRES_CONNECTION_STRING"],
  },
];

export class McpRegistry {
  private readonly specs = new Map<string, McpServerSpec>();

  constructor(seed: readonly McpServerSpec[] = DEFAULT_MCP_REGISTRY) {
    for (const spec of seed) this.specs.set(spec.id, spec);
  }

  add(spec: McpServerSpec): void {
    this.specs.set(spec.id, spec);
  }

  get(id: string): McpServerSpec | undefined {
    return this.specs.get(id);
  }

  has(id: string): boolean {
    return this.specs.has(id);
  }

  all(): McpServerSpec[] {
    return [...this.specs.values()];
  }

  /** Servers matching a capability or keyword query, best match first. */
  search(query: string): McpServerSpec[] {
    const normalized = query.toLowerCase().trim();
    const terms = normalized.split(/\s+/).filter(Boolean);
    return this.all()
      .map((spec) => {
        const haystack = [spec.id, spec.name, spec.description, ...spec.capabilities]
          .join(" ")
          .toLowerCase();
        let score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        if (spec.capabilities.some((capability) => capability.toLowerCase() === normalized)) score += 3;
        return { spec, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.spec);
  }

  /** Load and merge a JSON catalog ([{ ...McpServerSpec }]) from disk. */
  static fromFile(path: string, base: readonly McpServerSpec[] = DEFAULT_MCP_REGISTRY): McpRegistry {
    const registry = new McpRegistry(base);
    if (!existsSync(path)) return registry;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(parsed)) {
        for (const entry of parsed as McpServerSpec[]) registry.add(entry);
      }
    } catch (err) {
      throw new AnvilError("MCP_ERROR", `Failed to load the MCP registry file at "${path}".`, {
        cause: err,
      });
    }
    return registry;
  }
}
