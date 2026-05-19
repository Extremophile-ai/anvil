/**
 * The `create_skill` tool. The agent calls it when it identifies a capability
 * the harness lacks. Read-kind — it writes only to Anvil's own global library,
 * never the user's workspace — so it runs without approval friction.
 */
import { z } from "zod";
import { defineReadTool, type ReadTool } from "../tools/types.js";
import type { SkillFactory } from "./factory.js";

const createSkillSchema = z.strictObject({
  need: z.string().min(1),
  kind: z.enum(["skill", "tool", "plugin"]).default("skill"),
  context: z.string().optional(),
});

/** Build the `create_skill` tool, bound to a skill factory. */
export function createSkillTool(factory: SkillFactory): ReadTool {
  return defineReadTool({
    name: "create_skill",
    description:
      "Generate and register a reusable skill, tool, or plugin for a capability the harness " +
      "lacks. The new skill is validated before it is added to the global library.",
    schema: createSkillSchema,
    run: async (input, ctx) => {
      const request = input.context === undefined
        ? { need: input.need, kind: input.kind }
        : { need: input.need, kind: input.kind, context: input.context };
      const { skill, validation, registered } = await factory.create(request, ctx.jobId);
      return {
        ok: registered,
        summary: registered
          ? `Registered ${skill.kind} "${skill.name}" (v${skill.version}) in the global library.`
          : `Generated "${skill.name}" but it failed validation: ${validation.issues.join("; ")}`,
        data: { name: skill.name, kind: skill.kind, registered, issues: validation.issues },
      };
    },
  });
}
