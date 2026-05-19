/**
 * The `log_failure` tool. The agent calls it after any corrected mistake. It is
 * a read-kind tool — it touches only Anvil's own learning store, never the
 * user's workspace — so it runs freely, with no approval friction.
 */
import { z } from "zod";
import { defineReadTool, type ReadTool } from "../tools/types.js";
import type { LearningLoop } from "./loop.js";

const logFailureSchema = z.strictObject({
  whatHappened: z.string().min(1),
  rootCause: z.string().min(1),
  fixApplied: z.string().min(1),
  harnessImprovement: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

/** Build the `log_failure` tool, bound to a learning loop. */
export function createLogFailureTool(loop: LearningLoop): ReadTool {
  return defineReadTool({
    name: "log_failure",
    description:
      "Record a corrected mistake — what happened, root cause, fix, and the structural harness " +
      "improvement that prevents a repeat. Call this after any mistake is corrected.",
    schema: logFailureSchema,
    run: async (input, ctx) => {
      const { failure, evalCase } = await loop.logFailure({ ...input, jobId: ctx.jobId });
      return {
        ok: true,
        summary: `Logged failure ${failure.id} and seeded regression eval ${evalCase.id}.`,
        data: { failureId: failure.id, evalId: evalCase.id },
      };
    },
  });
}
