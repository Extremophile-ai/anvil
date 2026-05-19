/**
 * A dependency-free embedder built on feature hashing. It is not neural — it
 * captures lexical overlap rather than deep meaning — but it is deterministic,
 * instant, offline, and always available, so memory and recall work the moment
 * Anvil is installed, with no model download.
 */
import { type Embedder, l2normalize } from "./embedder.js";

/** 32-bit FNV-1a hash. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class HashEmbedder implements Embedder {
  readonly id = "hash-v1";
  readonly dimensions = 256;

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const token of tokens) {
      const index = fnv1a(token) % this.dimensions;
      const sign = (fnv1a(`${token}#sign`) & 1) === 0 ? 1 : -1;
      vec[index] = (vec[index] ?? 0) + sign;
    }
    return l2normalize(vec);
  }
}
