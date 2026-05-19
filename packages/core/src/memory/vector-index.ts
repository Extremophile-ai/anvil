/**
 * The vector layer of memory. Embeddings are stored as BLOBs in SQLite and
 * searched by brute-force cosine similarity. At memory's scale (hundreds to a
 * few thousand facts) this is exact and fast; the interface leaves room to swap
 * in an ANN index later without touching callers.
 */
import { cosineSimilarity, decodeVector, encodeVector } from "../embeddings/embedder.js";
import type { StateStore } from "../state/store.js";

export interface VectorHit {
  memoryId: string;
  score: number;
}

export class VectorIndex {
  constructor(private readonly store: StateStore) {}

  upsert(memoryId: string, embedderId: string, vector: number[]): void {
    this.store.db
      .prepare(
        `INSERT INTO memory_vectors (memory_id, embedder, dim, vector) VALUES (?, ?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
           embedder = excluded.embedder, dim = excluded.dim, vector = excluded.vector`,
      )
      .run(memoryId, embedderId, vector.length, encodeVector(vector));
  }

  remove(memoryId: string): void {
    this.store.db.prepare("DELETE FROM memory_vectors WHERE memory_id = ?").run(memoryId);
  }

  /** The `topK` stored vectors most similar to `query`, best first. */
  search(query: number[], topK: number): VectorHit[] {
    const rows = this.store.db
      .prepare("SELECT memory_id, vector FROM memory_vectors")
      .all() as Array<{ memory_id: string; vector: Uint8Array }>;
    const hits = rows.map((row) => ({
      memoryId: row.memory_id,
      score: cosineSimilarity(query, decodeVector(row.vector)),
    }));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, Math.max(0, topK));
  }
}
