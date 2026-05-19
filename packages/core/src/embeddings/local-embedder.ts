/**
 * Local neural embeddings via `@huggingface/transformers`. That package is an
 * optional dependency: it is loaded lazily through a dynamic import, so Anvil
 * installs and runs without it — `createEmbedder` falls back to the hash
 * embedder when it is absent.
 */
import { AnvilError } from "../lib/errors.js";
import type { Embedder } from "./embedder.js";

interface FeaturePipeline {
  (texts: string[], options: { pooling: "mean"; normalize: boolean }): Promise<{
    tolist(): number[][];
  }>;
}

interface TransformersModule {
  pipeline(task: "feature-extraction", model: string): Promise<FeaturePipeline>;
}

export class LocalEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;

  private constructor(
    private readonly pipe: FeaturePipeline,
    model: string,
    dimensions: number,
  ) {
    this.id = `local:${model}`;
    this.dimensions = dimensions;
  }

  static async create(
    model = "Xenova/all-MiniLM-L6-v2",
    dimensions = 384,
  ): Promise<LocalEmbedder> {
    // A widened specifier so TypeScript does not try to resolve the optional
    // dependency at build time.
    const moduleName: string = "@huggingface/transformers";
    let mod: TransformersModule;
    try {
      mod = (await import(moduleName)) as TransformersModule;
    } catch (err) {
      throw new AnvilError(
        "MEMORY_ERROR",
        "Local neural embeddings need the optional '@huggingface/transformers' package. " +
          "Install it (pnpm add @huggingface/transformers) or use the 'hash' or 'voyage' embedder.",
        { cause: err },
      );
    }
    const pipe = await mod.pipeline("feature-extraction", model);
    return new LocalEmbedder(pipe, model, dimensions);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const output = await this.pipe(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }
}
