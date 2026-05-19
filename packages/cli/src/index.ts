#!/usr/bin/env node
/**
 * anvil — the command-line interface over `@anvil/core`. Subcommands:
 *   build <task>     run the orchestrator against the current workspace
 *   ingest [<dir>]   profile a workspace and index its code
 *   memory list|recall <query>
 *   init [<dir>]     set up .anvil/ and register the MCP server
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Deliverer,
  EventBus,
  JsonlLogger,
  LearningLoop,
  MemoryManager,
  Orchestrator,
  SkillFactory,
  SkillLibrary,
  StateStore,
  ToolRegistry,
  Workspace,
  WorkspaceIngestor,
  builtinTools,
  createEmbedder,
  createLogFailureTool,
  createSkillTool,
} from "@anvil/core";
import type { MemoryScope } from "@anvil/shared";
import { type ParsedArgs, flagBool, flagInt, flagString, parseArgs } from "./parse-args.js";

const VERSION = "0.0.0";

function workspaceDir(positional: string[]): string {
  return positional[0] ?? process.cwd();
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function printHelp(): void {
  process.stdout.write(
    [
      "anvil — autonomous coding harness",
      "",
      "Commands:",
      "  anvil build <task>                Run the orchestrator end to end",
      "    [--skip-delivery] [--skip-reflection] [--no-tools]",
      "    [--model <name>] [--max-turns <n>]",
      "",
      "  anvil ingest [<dir>]              Profile the workspace and index its code",
      "",
      "  anvil memory list [--scope project|global]",
      "  anvil memory recall <query> [--top-k <n>]",
      "",
      "  anvil init [<dir>]                Set up .anvil/ and register anvil-mcp",
      "",
      "  anvil --version                   Print version",
      "  anvil --help                      This help",
      "",
    ].join("\n"),
  );
}

async function commandBuild(task: string, args: ParsedArgs): Promise<number> {
  const workspace = new Workspace(process.cwd());
  const dataDir = join(workspace.root, ".anvil");
  ensureDir(dataDir);
  const store = new StateStore(join(dataDir, "state.db"));
  const bus = new EventBus();
  new JsonlLogger(join(dataDir, "logs", "anvil.log")).attach(bus);

  bus.on((event) => {
    if (event.kind === "task.started") process.stdout.write(`  ▸ ${event.message}\n`);
    else if (event.kind === "task.finished") process.stdout.write(`  ◂ ${event.message}\n`);
    else if (event.kind === "approval.granted") process.stdout.write(`  · ${event.message}\n`);
    else if (event.kind === "healing.retry") process.stdout.write(`  ↻ ${event.message}\n`);
    else if (event.kind === "healing.escalated") process.stdout.write(`  ✗ ${event.message}\n`);
    else if (event.kind === "assistant.text") {
      const text = event.message.trim();
      if (text) process.stdout.write(`    ${text.slice(0, 200)}\n`);
    }
  });

  const embedder = await createEmbedder({ provider: "auto" });
  const memory = new MemoryManager({ store, embedder });
  const learning = new LearningLoop({
    store,
    memory,
    failuresPath: join(workspace.root, "failures.md"),
  });

  let toolRegistry: ToolRegistry | undefined;
  if (!flagBool(args, "no-tools")) {
    toolRegistry = new ToolRegistry({ workspace, bus });
    toolRegistry.registerAll(builtinTools());
    toolRegistry.register(createLogFailureTool(learning));
    const skillFactory = new SkillFactory({ library: new SkillLibrary(), bus });
    toolRegistry.register(createSkillTool(skillFactory));
  }

  const deliverer = existsSync(join(workspace.root, ".git")) ? new Deliverer({ workspace }) : undefined;

  const orchestrator = new Orchestrator({
    workspace,
    store,
    bus,
    memory,
    learning,
    ...(toolRegistry ? { toolRegistry } : {}),
    ...(deliverer ? { deliverer } : {}),
    ...(flagString(args, "model") ? { model: flagString(args, "model") as string } : {}),
  });

  const result = await orchestrator.build(task, {
    skipReflection: flagBool(args, "skip-reflection"),
    delivery: flagBool(args, "skip-delivery") ? "none" : "branch",
    ...(flagInt(args, "max-turns") !== undefined ? { maxTurns: flagInt(args, "max-turns") as number } : {}),
  });

  store.close();
  process.stdout.write(`\nstatus: ${result.job.status}\n`);
  if (result.branch) process.stdout.write(`branch: ${result.branch}\n`);
  if (result.pullRequestUrl) process.stdout.write(`PR:     ${result.pullRequestUrl}\n`);
  return result.job.status === "succeeded" ? 0 : 1;
}

async function commandIngest(args: ParsedArgs): Promise<number> {
  const workspace = new Workspace(workspaceDir(args.positional));
  ensureDir(join(workspace.root, ".anvil"));
  const store = new StateStore(join(workspace.root, ".anvil", "state.db"));
  const embedder = await createEmbedder({ provider: "auto" });
  const ingestor = new WorkspaceIngestor({ store, embedder });
  const result = await ingestor.ingest(workspace);
  store.close();
  process.stdout.write(`Ingested "${result.profile.name}"\n`);
  process.stdout.write(`  languages : ${result.profile.stack.languages.join(", ") || "(unknown)"}\n`);
  process.stdout.write(`  frameworks: ${result.profile.stack.frameworks.join(", ") || "(none detected)"}\n`);
  process.stdout.write(
    `  files     : ${result.profile.fileCount} total; ${result.index.files} indexed (${result.index.chunks} chunks)\n`,
  );
  return 0;
}

async function commandMemory(args: ParsedArgs): Promise<number> {
  const sub = args.positional[0] ?? "list";
  const workspace = new Workspace(process.cwd());
  ensureDir(join(workspace.root, ".anvil"));
  const store = new StateStore(join(workspace.root, ".anvil", "state.db"));
  const embedder = await createEmbedder({ provider: "auto" });
  const memory = new MemoryManager({ store, embedder });

  if (sub === "list") {
    const scope = flagString(args, "scope") as MemoryScope | undefined;
    const facts = memory.list(scope);
    for (const fact of facts) {
      process.stdout.write(`[${fact.scope}/${fact.type}] ${fact.name}: ${fact.description}\n`);
    }
    process.stdout.write(`${facts.length} fact(s)\n`);
    store.close();
    return 0;
  }

  if (sub === "recall") {
    const query = args.positional.slice(1).join(" ");
    if (!query) {
      process.stderr.write("Usage: anvil memory recall <query> [--top-k <n>]\n");
      store.close();
      return 1;
    }
    const hits = await memory.recall(query, { topK: flagInt(args, "top-k") ?? 5 });
    for (const hit of hits) {
      process.stdout.write(`${hit.score.toFixed(3)}  [${hit.fact.scope}/${hit.fact.type}] ${hit.fact.description}\n`);
    }
    store.close();
    return 0;
  }

  process.stderr.write(`Unknown memory subcommand: ${sub}\n`);
  store.close();
  return 1;
}

function commandInit(args: ParsedArgs): number {
  const workspace = new Workspace(workspaceDir(args.positional));
  const dataDir = join(workspace.root, ".anvil");
  ensureDir(dataDir);
  ensureDir(join(dataDir, "memory"));
  ensureDir(join(dataDir, "logs"));

  const mcpPath = join(workspace.root, ".mcp.json");
  let config: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(mcpPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      // start with an empty config if the file is corrupt
    }
  }
  const servers =
    (config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {});
  servers.anvil = { type: "stdio", command: "anvil-mcp", args: [] };
  config.mcpServers = servers;
  writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  process.stdout.write(`Initialised .anvil/ at ${workspace.root}\n`);
  process.stdout.write(`Wrote ${mcpPath} — Claude Code can now invoke anvil-mcp.\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (flagBool(args, "version") || args.command === "--version") {
    process.stdout.write(`anvil ${VERSION}\n`);
    return 0;
  }
  if (flagBool(args, "help") || args.command === "help" || args.command === "--help") {
    printHelp();
    return 0;
  }

  switch (args.command) {
    case "build": {
      const task = args.positional.join(" ");
      if (!task) {
        process.stderr.write("Usage: anvil build <task>\n");
        return 1;
      }
      return commandBuild(task, args);
    }
    case "ingest":
      return commandIngest(args);
    case "memory":
      return commandMemory(args);
    case "init":
      return commandInit(args);
    default:
      process.stderr.write(`Unknown command: ${args.command}\nRun 'anvil --help' for usage.\n`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  },
);
