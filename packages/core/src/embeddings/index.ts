/**
 * The embedder factory. `auto` prefers Voyage (when a key is supplied), then a
 * local neural model (when installed), and finally the always-available hash
 * embedder — so memory always works, and improves when configured.
 */
import { AnvilError } from "../lib/errors.js";
import type { Embedder } from "./embedder.js";
import { HashEmbedder } from "./hash-embedder.js";
import { LocalEmbedder } from "./local-embedder.js";
import { VoyageEmbedder } from "./voyage-embedder.js";

export * from "./embedder.js";
export { HashEmbedder } from "./hash-embedder.js";
export { LocalEmbedder } from "./local-embedder.js";
export { VoyageEmbedder } from "./voyage-embedder.js";

export type EmbedderProvider = "auto" | "hash" | "local" | "voyage";

export interface EmbedderConfig {
  provider?: EmbedderProvider;
  voyageApiKey?: string;
  voyageModel?: string;
  localModel?: string;
}

export async function createEmbedder(config: EmbedderConfig = {}): Promise<Embedder> {
  const provider = config.provider ?? "auto";

  if (provider === "hash") return new HashEmbedder();

  if (provider === "voyage") {
    if (!config.voyageApiKey) {
      throw new AnvilError("MEMORY_ERROR", "The 'voyage' embedder requires `voyageApiKey`.");
    }
    return new VoyageEmbedder(config.voyageApiKey, config.voyageModel);
  }

  if (provider === "local") {
    return LocalEmbedder.create(config.localModel);
  }

  // auto
  if (config.voyageApiKey) return new VoyageEmbedder(config.voyageApiKey, config.voyageModel);
  try {
    return await LocalEmbedder.create(config.localModel);
  } catch {
    return new HashEmbedder();
  }
}
