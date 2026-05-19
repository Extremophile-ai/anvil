import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./embedder.js";
import { HashEmbedder } from "./hash-embedder.js";

describe("HashEmbedder", () => {
  const embedder = new HashEmbedder();

  it("is deterministic and produces unit-length vectors", async () => {
    const [a] = await embedder.embed(["the quick brown fox"]);
    const [b] = await embedder.embed(["the quick brown fox"]);
    expect(a).toEqual(b);
    const norm = Math.sqrt((a ?? []).reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("scores related text above unrelated text", async () => {
    const [query] = await embedder.embed(["deploy the backend service to production"]);
    const [related] = await embedder.embed(["production deploy of the backend service"]);
    const [unrelated] = await embedder.embed(["a poem about autumn leaves and rain"]);
    expect(cosineSimilarity(query ?? [], related ?? [])).toBeGreaterThan(
      cosineSimilarity(query ?? [], unrelated ?? []),
    );
  });
});
