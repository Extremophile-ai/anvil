/**
 * Discovery tools — read-only, so they run without approval. They give the
 * agent an accurate picture of the workspace and prevent it from guessing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { defineReadTool, type ReadTool } from "../types.js";

const SKIP = new Set(["node_modules", ".git", "dist", ".anvil", "coverage"]);

function walk(root: string, start: string, maxEntries: number): string[] {
  const files: string[] = [];
  const stack: string[] = [start];
  while (stack.length > 0 && files.length < maxEntries) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else files.push(relative(root, full));
    }
  }
  return files;
}

function renderTree(dir: string, prefix: string, depth: number, maxDepth: number, lines: string[]): void {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const visible = entries
    .filter((entry) => !SKIP.has(entry.name) && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  visible.forEach((entry, index) => {
    const last = index === visible.length - 1;
    lines.push(`${prefix}${last ? "└─ " : "├─ "}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      renderTree(join(dir, entry.name), `${prefix}${last ? "   " : "│  "}`, depth + 1, maxDepth, lines);
    }
  });
}

const readFileTool = defineReadTool({
  name: "read_file",
  description: "Read a UTF-8 text file inside the workspace.",
  schema: z.strictObject({ path: z.string().min(1) }),
  run: (input, ctx) => {
    const abs = ctx.workspace.resolve(input.path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return Promise.resolve({
        ok: false,
        summary: `No file at "${input.path}". Use list_files or find_files to see what exists.`,
      });
    }
    const content = readFileSync(abs, "utf8");
    return Promise.resolve({
      ok: true,
      summary: `Read ${input.path} (${content.length} chars).`,
      data: { path: input.path, content },
    });
  },
});

const listFilesTool = defineReadTool({
  name: "list_files",
  description: "List the entries of a directory inside the workspace.",
  schema: z.strictObject({ dir: z.string().min(1).default(".") }),
  run: (input, ctx) => {
    const abs = ctx.workspace.resolve(input.dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return Promise.resolve({ ok: false, summary: `No directory at "${input.dir}".` });
    }
    const entries = readdirSync(abs, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }));
    return Promise.resolve({
      ok: true,
      summary: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in ${input.dir}.`,
      data: { dir: input.dir, entries },
    });
  },
});

const findFilesTool = defineReadTool({
  name: "find_files",
  description: "Find files whose path contains a query, skipping build and dependency directories.",
  schema: z.strictObject({
    query: z.string().min(1),
    dir: z.string().min(1).default("."),
    limit: z.number().int().positive().max(500).default(100),
  }),
  run: (input, ctx) => {
    const abs = ctx.workspace.resolve(input.dir);
    const query = input.query.toLowerCase();
    const matches = walk(ctx.workspace.root, abs, 5000)
      .filter((path) => path.toLowerCase().includes(query))
      .slice(0, input.limit);
    return Promise.resolve({
      ok: true,
      summary: `${matches.length} file(s) match "${input.query}".`,
      data: { matches },
    });
  },
});

const projectTreeTool = defineReadTool({
  name: "project_tree",
  description: "Render a directory tree of the workspace, skipping build and dependency directories.",
  schema: z.strictObject({
    dir: z.string().min(1).default("."),
    maxDepth: z.number().int().positive().max(8).default(3),
  }),
  run: (input, ctx) => {
    const abs = ctx.workspace.resolve(input.dir);
    if (!existsSync(abs)) {
      return Promise.resolve({ ok: false, summary: `No directory at "${input.dir}".` });
    }
    const lines: string[] = [];
    renderTree(abs, "", 1, input.maxDepth, lines);
    return Promise.resolve({
      ok: true,
      summary: `Tree of ${input.dir} (${lines.length} entries).`,
      data: { tree: lines.join("\n") },
    });
  },
});

export const discoveryTools: ReadTool[] = [readFileTool, listFilesTool, findFilesTool, projectTreeTool];
