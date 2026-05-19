#!/usr/bin/env node
/**
 * anvil-mcp — exposes Anvil as an MCP stdio server.
 *
 * Once registered in a workspace's `.mcp.json`, any MCP client (Claude Code,
 * Codex CLI, Gemini CLI, Cursor, ...) can call:
 *
 *   build_feature, goal, get_status, steer, interrupt,
 *   ingest_workspace, recall_memory, list_memory, current_job
 *
 * The server logs to stderr; stdout is reserved for the MCP protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AnvilService } from "@anvil/core";
import { z } from "zod";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function json(value: unknown, isError = false): ToolResult {
  const result: ToolResult = {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, true);
}

async function main(): Promise<void> {
  const service = await AnvilService.create(process.cwd());
  const server = new McpServer({ name: "anvil", version: "0.0.0" });

  server.tool(
    "build_feature",
    "Start an end-to-end Anvil build. Returns the jobId immediately; poll get_status for progress.",
    {
      task: z.string().min(1).describe("What to build, in plain language."),
      skipDelivery: z.boolean().optional().describe("Skip the git branch + commit step."),
      maxTurns: z.number().int().positive().optional(),
    },
    async ({ task, skipDelivery, maxTurns }) => {
      try {
        const opts: Parameters<typeof service.startBuild>[1] = {};
        if (skipDelivery !== undefined) opts.skipDelivery = skipDelivery;
        if (maxTurns !== undefined) opts.maxTurns = maxTurns;
        const result = await service.startBuild(task, opts);
        return json(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "goal",
    "Iterate Anvil toward a goal — its port of Claude Code's /goal. Returns the jobId; poll get_status.",
    {
      condition: z.string().min(1).describe("Completion condition in plain language."),
      task: z.string().optional().describe("Override the default 'Work toward: <condition>' task."),
      verify: z.array(z.string()).optional().describe("Shell commands to run as verifiers; all must exit 0."),
      maxIterations: z.number().int().positive().optional(),
    },
    async ({ condition, task, verify, maxIterations }) => {
      try {
        const goal: Parameters<typeof service.startBuild>[1] = {
          goal: {
            condition,
            ...(verify ? { verify } : {}),
            ...(maxIterations !== undefined ? { maxIterations } : {}),
          },
        };
        const realTask = task ?? `Work toward this goal: ${condition}`;
        const result = await service.startBuild(realTask, goal);
        return json(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_status",
    "Get the current status, plan, and result of a job.",
    { jobId: z.string().min(1) },
    ({ jobId }) => {
      const job = service.getStatus(jobId);
      if (!job) return json({ error: `No job with id ${jobId}.` }, true);
      return json(job);
    },
  );

  server.tool(
    "steer",
    "Inject a mid-build correction into the running job.",
    { jobId: z.string().min(1), text: z.string().min(1) },
    ({ jobId, text }) => {
      try {
        return json(service.steer(jobId, text));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "interrupt",
    "Stop the running build.",
    { jobId: z.string().min(1) },
    async ({ jobId }) => {
      try {
        return json(await service.interrupt(jobId));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "ingest_workspace",
    "Profile a workspace and index its source code into Anvil's semantic store.",
    { dir: z.string().optional() },
    async ({ dir }) => {
      try {
        const result = await service.ingest(dir);
        return json(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "recall_memory",
    "Semantic recall over Anvil's memory.",
    { query: z.string().min(1), topK: z.number().int().positive().optional() },
    async ({ query, topK }) => {
      try {
        return json(await service.recall(query, topK));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_memory",
    "List remembered facts.",
    { scope: z.enum(["project", "global"]).optional() },
    ({ scope }) => json(service.listMemory(scope)),
  );

  server.tool(
    "current_job",
    "Return the active job id, if any.",
    {},
    () => json({ jobId: service.currentJob() ?? null }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("anvil-mcp ready on stdio\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`anvil-mcp fatal: ${message}\n`);
  process.exit(1);
});
