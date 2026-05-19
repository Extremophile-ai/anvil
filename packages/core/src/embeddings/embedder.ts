/**
 * The embedder abstraction. Memory and the learning loop depend only on this
 * interface; the concrete model (hash, local neural, or Voyage) is swappable.
 */

export interface Embedder {
  /** Stable id of this embedder + model — every stored vector is tagged with it. */
  readonly id: string;
  /** Output vector length. */
  readonly dimensions: number;
  /** Embed a batch of texts. Results align by index with the input. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Cosine similarity of two vectors, in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Scale a vector to unit length. A zero vector is returned unchanged. */
export function l2normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec.slice();
  return vec.map((v) => v / norm);
}

/** Encode a vector as a compact Float32 byte buffer for BLOB storage. */
export function encodeVector(vector: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vector).buffer);
}

/** Decode a Float32 byte buffer back into a vector. */
export function decodeVector(blob: Uint8Array): number[] {
  const copy = Uint8Array.from(blob);
  return Array.from(new Float32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4)));
}
