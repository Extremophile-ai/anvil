/**
 * Skill generation. The template generator is deterministic and offline — it
 * scaffolds a usable skill or tool from a request. An LLM-backed generator can
 * be supplied for genuinely novel skills; both satisfy `SkillGenerator`.
 */
import { slugify } from "../lib/text.js";
import type { SkillDraft, SkillGenerator, SkillRequest } from "./types.js";

const STOPWORDS = new Set([
  "the", "a", "an", "to", "for", "of", "and", "or", "with", "that", "this",
  "it", "is", "be", "in", "on", "needs", "need", "able", "should",
]);

function deriveCapabilities(need: string): string[] {
  const words = need
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return [...new Set(words ?? [])].slice(0, 5);
}

function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function toolTemplate(name: string, request: SkillRequest): string {
  return `import { z } from "zod";
import { defineReadTool } from "@anvil/core";

/** ${request.need} */
export const ${camelCase(name)}Tool = defineReadTool({
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(request.need)},
  schema: z.strictObject({ input: z.string().min(1) }),
  run: (input) =>
    Promise.resolve({ ok: true, summary: "TODO: implement ${name}", data: input }),
});
`;
}

function skillTemplate(name: string, request: SkillRequest): string {
  const title = name.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return `# ${title}

${request.need}

## When to use

Use this skill when the task involves: ${request.need}.

## Steps

1. Understand exactly what the task needs.
2. Apply the capability described above.
3. Verify the result before reporting it done.

${request.context ? `## Context\n\n${request.context}\n` : ""}`;
}

export class TemplateSkillGenerator implements SkillGenerator {
  generate(request: SkillRequest): Promise<SkillDraft> {
    const kind = request.kind ?? "skill";
    const name = slugify(request.need);
    const capabilities = deriveCapabilities(request.need);
    if (capabilities.length === 0) capabilities.push(name);
    const content = kind === "tool" ? toolTemplate(name, request) : skillTemplate(name, request);
    return Promise.resolve({
      name,
      kind,
      description: `${kind === "tool" ? "Tool" : "Skill"} for: ${request.need}`,
      content,
      capabilities,
      tags: [...new Set([kind, ...capabilities])].slice(0, 6),
    });
  }
}
