/**
 * Voyage AI embeddings — the opt-in higher-quality option. Requires an API key
 * and makes a network call per batch.
 */
import { AnvilError } from "../lib/errors.js";
import type { Embedder } from "./embedder.js";

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export class VoyageEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;

  constructor(
    private readonly apiKey: string,
    private readonly model = "voyage-3.5",
    dimensions = 1024,
  ) {
    this.id = `voyage:${model}`;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    let response: Response;
    try {
      response = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (err) {
      throw new AnvilError("MEMORY_ERROR", "Voyage embeddings request could not be sent.", {
        retryable: true,
        cause: err,
      });
    }
    if (!response.ok) {
      throw new AnvilError(
        "MEMORY_ERROR",
        `Voyage embeddings request failed: ${response.status} ${response.statusText}.`,
        { retryable: response.status >= 500 },
      );
    }
    const json = (await response.json()) as VoyageResponse;
    return json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding);
  }
}
