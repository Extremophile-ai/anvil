import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument } from "./frontmatter.js";

describe("frontmatter", () => {
  it("round-trips frontmatter and body", () => {
    const doc = serializeDocument({ name: "use-pnpm", type: "project" }, "The package manager is pnpm.");
    const parsed = parseDocument(doc);
    expect(parsed.frontmatter.name).toBe("use-pnpm");
    expect(parsed.frontmatter.type).toBe("project");
    expect(parsed.body).toBe("The package manager is pnpm.");
  });

  it("handles content with no frontmatter", () => {
    const parsed = parseDocument("just a body, no frontmatter");
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("just a body, no frontmatter");
  });
});
