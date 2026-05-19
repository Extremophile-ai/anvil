/**
 * Anvil live build smoke — drives a real end-to-end build through Opus.
 *
 * Run with: `pnpm smoke:build` (builds first).
 *
 * Authentication: same as `pnpm smoke:live` — your Claude.ai subscription via
 * Claude Code on this machine, or ANTHROPIC_API_KEY.
 *
 * This makes a real model call and writes files into a temp workspace; it is
 * deliberately separate from `pnpm test` and `pnpm smoke`.
 *
 * What it proves:
 *   - The orchestrator plans, runs, and finishes a tiny task end-to-end.
 *   - The agent routes its writes through Anvil's mcp__anvil__write_file
 *     (raw Write/Edit are disallowed), so every change is audited.
 *   - The file actually lands on disk with the requested contents.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EventBus,
  Orchestrator,
  StateStore,
  ToolRegistry,
  Workspace,
  builtinTools,
} from "../packages/core/dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "anvil-build-smoke-"));
const workspace = new Workspace(dir);
const store = new StateStore(":memory:");
const bus = new EventBus();
bus.on((event) => {
  if (event.kind === "task.started") console.log(`  ▸ ${event.message}`);
  if (event.kind === "task.finished") console.log(`  ◂ ${event.message}`);
  if (event.kind === "approval.granted") console.log(`  · ${event.message}`);
  if (event.kind === "tool.use") {
    const data = event.data as { tool?: string } | undefined;
    if (data?.tool) console.log(`    [${data.tool}]`);
  }
  if (event.kind === "assistant.text") {
    const text = event.message.trim();
    if (text) console.log(`    "${text.slice(0, 160)}${text.length > 160 ? "…" : ""}"`);
  }
});

const toolRegistry = new ToolRegistry({ workspace, bus });
toolRegistry.registerAll(builtinTools());

const orchestrator = new Orchestrator({
  workspace,
  store,
  bus,
  toolRegistry,
});

console.log("Anvil — live build smoke. Driving a tiny end-to-end build through Opus.\n");
const startedAt = Date.now();

const result = await orchestrator.build(
  "Create a file named hello.ts in the workspace root that exports a function called hello taking no arguments and returning the string 'hello, world'. Use the mcp__anvil__write_file tool.",
  { delivery: "none", skipReflection: true, maxTurns: 8 },
);

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
const filePath = join(dir, "hello.ts");
const fileExists = existsSync(filePath);
const fileContent = fileExists ? readFileSync(filePath, "utf8") : "";
const looksRight = fileContent.includes("hello") && fileContent.includes("hello, world");

console.log(`\nstatus    : ${result.job.status}`);
console.log(`duration  : ${seconds}s`);
console.log(`nodes     : ${result.plan.nodes.map((node) => `${node.id}=${node.status}`).join(", ")}`);
console.log(`hello.ts  : ${fileExists ? "written" : "missing"}`);
if (fileExists) console.log(`content   :\n${fileContent.replace(/^/gm, "  | ")}`);

store.close();
rmSync(dir, { recursive: true, force: true });

const ok = result.job.status === "succeeded" && fileExists && looksRight;
console.log(ok ? "\nBUILD SMOKE OK" : "\nBUILD SMOKE FAILED");
process.exit(ok ? 0 : 1);
