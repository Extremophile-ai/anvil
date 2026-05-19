/**
 * The memory manager — the single entry point for what the harness knows.
 * It keeps three things in sync: the canonical markdown files, the SQLite
 * mirror used for lookups, and the vector index used for semantic recall.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type MemoryFact,
  type MemoryId,
  type MemoryScope,
  type MemoryType,
  type RecallResult,
  type RememberInput,
  newMemoryId,
  rememberInputSchema,
} from "@anvil/shared";
import type { Embedder } from "../embeddings/embedder.js";
import { slugify } from "../lib/text.js";
import type { StateStore } from "../state/store.js";
import { MemoryFileStore } from "./file-store.js";
import { VectorIndex } from "./vector-index.js";

const MEMORY_SCOPES: readonly MemoryScope[] = ["project", "global"];

export interface MemoryManagerConfig {
  store: StateStore;
  embedder: Embedder;
  /** Directory for project-scoped memory. Default `<cwd>/.anvil/memory`. */
  projectDir?: string;
  /** Directory for global memory. Default `~/.anvil/memory`. */
  globalDir?: string;
  /** Cosine similarity at or above which a new fact updates an existing one. */
  dedupeThreshold?: number;
}

export interface RecallOptions {
  topK?: number;
  scope?: MemoryScope;
  type?: MemoryType;
  minScore?: number;
}

function rowToFact(row: Record<string, unknown>): MemoryFact {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.tags ?? "[]"));
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    id: String(row.id) as MemoryId,
    name: String(row.name),
    scope: String(row.scope) as MemoryScope,
    type: String(row.type) as MemoryType,
    description: String(row.description),
    body: String(row.body),
    tags,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class MemoryManager {
  private readonly store: StateStore;
  private readonly embedder: Embedder;
  private readonly files: MemoryFileStore;
  private readonly vectors: VectorIndex;
  private readonly dedupeThreshold: number;

  constructor(config: MemoryManagerConfig) {
    this.store = config.store;
    this.embedder = config.embedder;
    this.vectors = new VectorIndex(config.store);
    this.dedupeThreshold = config.dedupeThreshold ?? 0.92;
    this.files = new MemoryFileStore({
      project: config.projectDir ?? join(process.cwd(), ".anvil", "memory"),
      global: config.globalDir ?? join(homedir(), ".anvil", "memory"),
    });
  }

  /** Re-read every fact file and rebuild the SQLite mirror + vector index. */
  async reindex(): Promise<number> {
    this.store.db.exec("DELETE FROM memory_vectors; DELETE FROM memory_facts;");
    let count = 0;
    for (const scope of MEMORY_SCOPES) {
      for (const fact of this.files.list(scope)) {
        await this.persist(fact);
        count += 1;
      }
    }
    return count;
  }

  /** Store a new fact — or, if it nearly duplicates an existing one, update that. */
  async remember(input: RememberInput): Promise<MemoryFact> {
    const parsed = rememberInputSchema.parse(input);
    const now = new Date().toISOString();
    const [embedding] = await this.embedder.embed([`${parsed.description}\n\n${parsed.body}`]);

    if (embedding) {
      const [nearest] = this.vectors.search(embedding, 1);
      if (nearest && nearest.score >= this.dedupeThreshold) {
        const existing = this.factById(nearest.memoryId);
        if (existing && existing.scope === parsed.scope && existing.type === parsed.type) {
          const updated: MemoryFact = {
            ...existing,
            description: parsed.description,
            body: parsed.body,
            tags: parsed.tags,
            updatedAt: now,
          };
          this.files.write(updated);
          await this.persist(updated, embedding);
          return updated;
        }
      }
    }

    const base = slugify(parsed.name ?? parsed.description);
    const fact: MemoryFact = {
      id: newMemoryId(),
      name: this.uniqueName(base, parsed.scope),
      scope: parsed.scope,
      type: parsed.type,
      description: parsed.description,
      body: parsed.body,
      tags: parsed.tags,
      createdAt: now,
      updatedAt: now,
    };
    this.files.write(fact);
    await this.persist(fact, embedding);
    return fact;
  }

  /** Semantic recall — the facts most relevant to a query, best first. */
  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult[]> {
    const topK = options.topK ?? 5;
    const [embedding] = await this.embedder.embed([query]);
    if (!embedding) return [];
    const hits = this.vectors.search(embedding, topK * 4);
    const results: RecallResult[] = [];
    for (const hit of hits) {
      if (options.minScore !== undefined && hit.score < options.minScore) continue;
      const fact = this.factById(hit.memoryId);
      if (!fact) continue;
      if (options.scope && fact.scope !== options.scope) continue;
      if (options.type && fact.type !== options.type) continue;
      results.push({ fact, score: hit.score });
      if (results.length >= topK) break;
    }
    return results;
  }

  get(name: string, scope: MemoryScope = "project"): MemoryFact | undefined {
    return this.files.read(scope, name);
  }

  list(scope?: MemoryScope): MemoryFact[] {
    if (scope) return this.files.list(scope);
    return MEMORY_SCOPES.flatMap((s) => this.files.list(s));
  }

  /** Delete a fact — from disk, the mirror, and the vector index. */
  forget(name: string, scope: MemoryScope = "project"): boolean {
    const fact = this.files.read(scope, name);
    if (!fact) return false;
    this.files.remove(scope, name);
    this.vectors.remove(fact.id);
    this.store.db.prepare("DELETE FROM memory_facts WHERE id = ?").run(fact.id);
    return true;
  }

  // --- internals -----------------------------------------------------------

  private async persist(fact: MemoryFact, embedding?: number[]): Promise<void> {
    this.store.db
      .prepare(
        `INSERT INTO memory_facts
           (id, name, scope, type, description, body, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, scope = excluded.scope, type = excluded.type,
           description = excluded.description, body = excluded.body, tags = excluded.tags,
           updated_at = excluded.updated_at`,
      )
      .run(
        fact.id,
        fact.name,
        fact.scope,
        fact.type,
        fact.description,
        fact.body,
        JSON.stringify(fact.tags),
        fact.createdAt,
        fact.updatedAt,
      );

    const vector = embedding ?? (await this.embedder.embed([`${fact.description}\n\n${fact.body}`]))[0];
    if (vector) this.vectors.upsert(fact.id, this.embedder.id, vector);
  }

  private factById(id: string): MemoryFact | undefined {
    const row = this.store.db.prepare("SELECT * FROM memory_facts WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToFact(row) : undefined;
  }

  private uniqueName(base: string, scope: MemoryScope): string {
    let name = base;
    let counter = 2;
    while (this.files.read(scope, name)) {
      name = `${base}-${counter}`;
      counter += 1;
    }
    return name;
  }
}
