/**
 * Prompt builders for the orchestrator. The system prompt frames the agent;
 * the node prompt scopes one plan step at a time.
 */
import type { Plan, PlanNode } from "@anvil/shared";
import { truncate } from "../lib/text.js";

export interface NodePromptInput {
  task: string;
  node: PlanNode;
  plan: Plan;
  context?: string;
}

export function buildSystemPrompt(): string {
  return [
    "You are Anvil's build agent, executing one step of a larger plan at a time.",
    "Stay within the workspace. Make small, focused changes. Run tests as you go.",
    "When you have finished the assigned step, summarize what you did in a short paragraph and stop. Do not call any more tools after the summary.",
  ].join(" ");
}

export function buildNodePrompt(input: NodePromptInput): string {
  const progress = input.plan.nodes
    .filter((node) => node.kind !== "epic")
    .map((node) => {
      const marker = node.id === input.node.id ? " ← THIS STEP" : "";
      return `- ${node.id} [${node.status}]${marker}: ${node.title}`;
    })
    .join("\n");

  const lines: string[] = [
    `Overall task: ${input.task}`,
    "",
    "Plan progress:",
    progress,
    "",
    `### Your step: ${input.node.title}`,
    input.node.description || "(no description)",
  ];
  if (input.node.surface) lines.push(`Surface: ${input.node.surface}`);
  if (input.context) {
    lines.push("", "Relevant context:", truncate(input.context, 2000));
  }
  lines.push(
    "",
    "Complete this step only. Briefly summarize what you did when you are finished, then stop.",
  );
  return lines.join("\n");
}
