/**
 * File-operation tools — write tools, so each goes through two-phase approval.
 * They replace raw `fs` / `mv` / `rm` access. Nothing here hard-deletes:
 * removal moves to the trash.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { moveToTrash } from "../trash.js";
import { defineWriteTool, type WriteTool } from "../types.js";

const writeFileTool = defineWriteTool({
  name: "write_file",
  description: "Create or overwrite a UTF-8 text file inside the workspace.",
  schema: z.strictObject({ path: z.string().min(1), content: z.string() }),
  preview: (input, ctx) => {
    const exists = existsSync(ctx.workspace.resolve(input.path));
    return Promise.resolve({
      summary: `${exists ? "Overwrite" : "Create"} ${input.path} (${input.content.length} chars).`,
      details: { exists, bytes: Buffer.byteLength(input.content) },
    });
  },
  execute: (input, ctx) => {
    const abs = ctx.workspace.resolve(input.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, input.content);
    return Promise.resolve({ ok: true, summary: `Wrote ${input.path}.` });
  },
});

const moveFileTool = defineWriteTool({
  name: "move_file",
  description: "Move or rename a file inside the workspace.",
  schema: z.strictObject({ from: z.string().min(1), to: z.string().min(1) }),
  preview: (input, ctx) => {
    const exists = existsSync(ctx.workspace.resolve(input.from));
    return Promise.resolve({
      summary: exists
        ? `Move ${input.from} -> ${input.to}.`
        : `Cannot move: "${input.from}" does not exist.`,
      details: { exists },
    });
  },
  execute: (input, ctx) => {
    const fromAbs = ctx.workspace.resolve(input.from);
    if (!existsSync(fromAbs)) {
      return Promise.resolve({ ok: false, summary: `Cannot move: "${input.from}" does not exist.` });
    }
    const toAbs = ctx.workspace.resolve(input.to);
    mkdirSync(dirname(toAbs), { recursive: true });
    renameSync(fromAbs, toAbs);
    return Promise.resolve({ ok: true, summary: `Moved ${input.from} -> ${input.to}.` });
  },
});

const deleteFileTool = defineWriteTool({
  name: "delete_file",
  description: "Remove a file by moving it to the workspace trash — never a hard delete.",
  schema: z.strictObject({ path: z.string().min(1) }),
  preview: (input, ctx) => {
    const exists = existsSync(ctx.workspace.resolve(input.path));
    return Promise.resolve({
      summary: exists
        ? `Move ${input.path} to .anvil/trash/ — recoverable, not deleted.`
        : `Nothing to remove: "${input.path}" does not exist.`,
      details: { exists },
    });
  },
  execute: (input, ctx) => {
    if (!existsSync(ctx.workspace.resolve(input.path))) {
      return Promise.resolve({ ok: false, summary: `Nothing to remove: "${input.path}" does not exist.` });
    }
    const trashed = ctx.workspace.relative(moveToTrash(ctx.workspace, input.path));
    return Promise.resolve({ ok: true, summary: `Moved ${input.path} to ${trashed}.` });
  },
});

export const fileOpTools: WriteTool[] = [writeFileTool, moveFileTool, deleteFileTool];
