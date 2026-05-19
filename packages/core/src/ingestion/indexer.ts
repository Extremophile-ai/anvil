/**
 * The code indexer — walks a workspace's source files, splits them into line
 * windows, embeds each, and stores the vectors so the harness can recall
 * relevant code semantically.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { cosineSimilarity, decodeVector, type Embedder, encodeVector } from "../embeddings/embedder.js";
import { walkFiles } from "../lib/fs.js";
import type { Workspace } from "../lib/workspace.js";
import type { StateStore } from "../state/store.js";
import type { CodeHit } from "./types.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".cpp", ".h", ".cs", ".swift", ".kt", ".md", ".json",
  ".yaml", ".yml", ".sql", ".sh",
]);
const CHUNK_LINES = 40;
const MAX_FILE_BYTES = 200_000;

function isSourceFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function chunkContent(content: string): Array<{ startLine: number; endLine: number; text: string }> {
  const lines = content.split("\n");
  const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    const text = slice.join("\n").trim();
    if (text.length > 0) chunks.push({ startLine: i + 1, endLine: i + slice.length, text });
  }
  return chunks;
}

export interface IndexOptions {
  maxFiles?: number;
}

export class CodeIndexer {
  private readonly store: StateStore;
  private readonly embedder: Embedder;

  constructor(deps: { store: StateStore; embedder: Embedder }) {
    this.store = deps.store;
    this.embedder = deps.embedder;
  }

  clear(): void {
    this.store.db.exec("DELETE FROM code_chunks;");
  }

  /** Index every source file in the workspace, replacing any prior index. */
  async indexWorkspace(workspace: Workspace, options: IndexOptions = {}): Promise<{ files: number; chunks: number }> {
    this.clear();
    const maxFiles = options.maxFiles ?? 1000;
    const files = walkFiles(workspace.root, { maxEntries: 20_000 })
      .filter(isSourceFile)
      .slice(0, maxFiles);
    let chunks = 0;
    for (const relativePath of files) {
      chunks += await this.indexFile(workspace, relativePath);
    }
    return { files: files.length, chunks };
  }

  /** Index a single file; returns the number of chunks stored. */
  async indexFile(workspace: Workspace, relativePath: string): Promise<number> {
    const abs = workspace.resolve(relativePath);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return 0;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return 0;

    const chunks = chunkContent(readFileSync(abs, "utf8"));
    if (chunks.length === 0) return 0;
    const vectors = await this.embedder.embed(chunks.map((chunk) => `${relativePath}\n${chunk.text}`));
    const insert = this.store.db.prepare(
      `INSERT INTO code_chunks (id, path, start_line, end_line, content, embedder, vector)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    chunks.forEach((chunk, index) => {
      const vector = vectors[index];
      if (!vector) return;
      insert.run(
        `chunk_${randomUUID()}`,
        relativePath,
        chunk.startLine,
        chunk.endLine,
        chunk.text,
        this.embedder.id,
        encodeVector(vector),
      );
    });
    return chunks.length;
  }

  /** Semantic search over the indexed code, best match first. */
  async search(query: string, topK = 8): Promise<CodeHit[]> {
    const [embedding] = await this.embedder.embed([query]);
    if (!embedding) return [];
    const rows = this.store.db
      .prepare("SELECT id, path, start_line, end_line, content, vector FROM code_chunks")
      .all() as Array<{
      id: string;
      path: string;
      start_line: number;
      end_line: number;
      content: string;
      vector: Uint8Array;
    }>;
    return rows
      .map((row) => ({
        id: row.id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        content: row.content,
        score: cosineSimilarity(embedding, decodeVector(row.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
