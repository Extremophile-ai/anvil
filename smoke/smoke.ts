/**
 * Anvil offline integration smoke.
 *
 * Exercises every @anvil/core subsystem end-to-end against the built `dist` —
 * no network, no API key. Run with: `pnpm smoke` (which builds first).
 *
 * This complements `pnpm test` (unit + integration tests): the smoke proves
 * the *packaged* engine works, the way a consumer imports it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnvilError,
  EventBus,
  GitCheckpoints,
  HashEmbedder,
  JsonlLogger,
  LearningLoop,
  McpManager,
  MemoryManager,
  Runtime,
  SelfHealer,
  SkillFactory,
  SkillLibrary,
  StateStore,
  StrikeBoard,
  ToolRegistry,
  Workspace,
  WorkspaceIngestor,
  builtinTools,
  createLogFailureTool,
  createSkillTool,
} from "../packages/core/dist/index.js";
import { type AnvilEvent, newJobId } from "../packages/shared/dist/index.js";

const results: boolean[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function phase(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}\n      ${message}`);
  }
}

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), `anvil-smoke-${prefix}-`));

console.log("Anvil — offline integration smoke\n");

await phase("runtime: events, JSONL audit log, traversal guard", async () => {
  const dir = tmp("rt");
  const bus = new EventBus();
  const seen: AnvilEvent[] = [];
  bus.on((event) => seen.push(event));
  const logger = new JsonlLogger(join(dir, "logs", "anvil.log"));
  logger.attach(bus);
  const jobId = newJobId();
  bus.publish(jobId, "run.started", "info", "smoke");
  bus.publish(jobId, "tool.use", "info", "Tool: Read", { tool: "Read" });
  bus.publish(jobId, "run.finished", "info", "done");
  await logger.close();
  const lines = readFileSync(join(dir, "logs", "anvil.log"), "utf8").trim().split("\n");
  assert(seen.length === 3 && lines.length === 3, "expected 3 events and 3 JSONL lines");
  assert(new Runtime({ bus, config: { cwd: dir } }).running === false, "runtime should start idle");
  let guarded = false;
  try {
    new Workspace(dir).resolve("../escape");
  } catch (err) {
    guarded = err instanceof AnvilError && err.code === "PATH_OUTSIDE_WORKSPACE";
  }
  assert(guarded, "traversal guard did not fire");
  rmSync(dir, { recursive: true, force: true });
});

await phase("memory: remember, semantic recall, dedupe, reindex", async () => {
  const dir = tmp("mem");
  const store = new StateStore(join(dir, "state.db"));
  const memory = new MemoryManager({
    store,
    embedder: new HashEmbedder(),
    projectDir: join(dir, "project"),
    globalDir: join(dir, "global"),
  });
  await memory.remember({ description: "Deploys use Docker", body: "Services run in Docker.", type: "project" });
  await memory.remember({ description: "Deploys use Docker", body: "Services run in Docker.", type: "project" });
  assert(memory.list("project").length === 1, "near-duplicate was not deduped");
  assert((await memory.recall("how are services shipped with docker")).length > 0, "recall returned nothing");
  assert((await memory.reindex()) === 1, "reindex count is wrong");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

await phase("self-healing: checkpoint, rollback, escalation", async () => {
  const dir = tmp("heal");
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir });
  };
  git("init", "-q");
  git("config", "user.email", "smoke@anvil.dev");
  git("config", "user.name", "Anvil Smoke");
  writeFileSync(join(dir, "f.ts"), "ok\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const bus = new EventBus();
  const kinds: string[] = [];
  bus.on((event) => kinds.push(event.kind));
  const healer = new SelfHealer({ bus, git: new GitCheckpoints(dir), strikes: new StrikeBoard(1) });
  let escalated = false;
  try {
    await healer.run(
      { jobId: newJobId(), label: "risky", retry: { baseDelayMs: 1, jitter: false } },
      async () => {
        writeFileSync(join(dir, "f.ts"), "broken\n");
        throw new Error("step failed");
      },
    );
  } catch {
    escalated = true;
  }
  assert(escalated, "the healer did not escalate");
  assert(readFileSync(join(dir, "f.ts"), "utf8") === "ok\n", "the working tree was not rolled back");
  assert(
    kinds.includes("checkpoint.restored") && kinds.includes("healing.escalated"),
    "missing healing events",
  );
  rmSync(dir, { recursive: true, force: true });
});

await phase("tools: two-phase approval, single-use token", async () => {
  const dir = tmp("tools");
  writeFileSync(join(dir, "a.txt"), "hi");
  const registry = new ToolRegistry({ workspace: new Workspace(dir), bus: new EventBus() });
  registry.registerAll(builtinTools());
  const jobId = newJobId();
  const call = await registry.call(jobId, "write_file", { path: "b.txt", content: "x" });
  assert(call.status === "approval-required", "a write tool ran without approval");
  assert(!existsSync(join(dir, "b.txt")), "the file was written before approval");
  await registry.approve(jobId, call.token);
  assert(existsSync(join(dir, "b.txt")), "the file was not written after approval");
  let reused = false;
  try {
    await registry.approve(jobId, call.token);
  } catch {
    reused = true;
  }
  assert(reused, "an approval token was reusable");
  rmSync(dir, { recursive: true, force: true });
});

await phase("mcp: discover, gate installs (approved + curated)", async () => {
  const dir = tmp("mcp");
  const store = new StateStore(join(dir, "state.db"));
  const mcp = new McpManager({ store });
  assert(mcp.discover("browser end-to-end testing")[0]?.id === "playwright", "discovery failed");
  let refusedUnapproved = false;
  let refusedRogue = false;
  try {
    await mcp.install("filesystem", { approved: false });
  } catch {
    refusedUnapproved = true;
  }
  try {
    await mcp.install(
      { id: "rogue", name: "R", description: "x", transport: "stdio", command: "sh", capabilities: [] },
      { approved: true },
    );
  } catch {
    refusedRogue = true;
  }
  assert(refusedUnapproved && refusedRogue, "install gating failed");
  await mcp.install("filesystem", { approved: true });
  const stdio = mcp.configs().filesystem;
  assert(stdio !== undefined && "type" in stdio && stdio.type === "stdio", "runtime config wrong");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

await phase("learning: log_failure, failures.md, regression eval, reflect", async () => {
  const dir = tmp("learn");
  const store = new StateStore(join(dir, "state.db"));
  const memory = new MemoryManager({
    store,
    embedder: new HashEmbedder(),
    projectDir: join(dir, "project"),
    globalDir: join(dir, "global"),
  });
  const loop = new LearningLoop({ store, memory, failuresPath: join(dir, "failures.md") });
  const registry = new ToolRegistry({ workspace: new Workspace(dir), bus: new EventBus() });
  registry.register(createLogFailureTool(loop));
  await registry.call(newJobId(), "log_failure", {
    whatHappened: "used raw rm",
    rootCause: "no removal tool",
    fixApplied: "restored from git",
    harnessImprovement: "delete_file tool moves to trash",
    severity: "high",
  });
  assert(loop.failures.count() === 1, "the failure was not recorded");
  assert(loop.evals.list().length === 1, "a regression eval was not seeded");
  assert(readFileSync(join(dir, "failures.md"), "utf8").includes("used raw rm"), "failures.md not written");
  const reflection = await loop.reflect({
    jobId: newJobId(),
    task: "build a page",
    outcome: "success",
    corrections: ["use the shared currency helper"],
  });
  assert(reflection.lessons.length === 1, "reflection produced no lesson");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

await phase("skills: generate, validate, register, acquire-reuse", async () => {
  const dir = tmp("skills");
  const factory = new SkillFactory({ library: new SkillLibrary(join(dir, "library")) });
  const registry = new ToolRegistry({ workspace: new Workspace(dir), bus: new EventBus() });
  registry.register(createSkillTool(factory));
  const created = await registry.call(newJobId(), "create_skill", {
    need: "generate an openapi spec from express routes",
    kind: "tool",
  });
  assert(created.status === "completed" && created.outcome.ok, "create_skill failed");
  const reused = await factory.acquire({ need: "generate an openapi spec from express routes" });
  assert(reused.created === false, "acquire regenerated instead of reusing");
  rmSync(dir, { recursive: true, force: true });
});

await phase("ingestion: stack detection, profile, code index + search", async () => {
  const dir = tmp("ingest");
  const store = new StateStore(join(dir, "state.db"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "shop", dependencies: { express: "4" } }));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src", "checkout.ts"),
    "export function processPayment(amount) {\n  return amount * 1.2;\n}\n",
  );
  writeFileSync(join(dir, "src", "auth.ts"), "export function login(user) {\n  return user;\n}\n");
  const ingestor = new WorkspaceIngestor({ store, embedder: new HashEmbedder() });
  const result = await ingestor.ingest(new Workspace(dir));
  assert(result.profile.name === "shop", "project name not detected");
  assert(result.profile.stack.frameworks.includes("express"), "framework not detected");
  assert(result.index.chunks > 0, "no code was indexed");
  const hits = await ingestor.search("amount paid at checkout");
  assert(hits[0]?.path === "src/checkout.ts", "semantic code search returned the wrong file");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} phases passed`);
process.exit(passed === results.length ? 0 : 1);
