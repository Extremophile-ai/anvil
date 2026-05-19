/**
 * Planning — turn a task into a plan DAG the orchestrator can execute.
 *
 * Two implementations: a deterministic heuristic planner that always works
 * offline (and is the default for tests), and an LLM-backed planner that uses
 * the Runtime to ask the model for a JSON plan and validates it with the
 * shared plan schema.
 */
import { type Plan, type PlanNode, type PlanSurface, newJobId, planSchema } from "@anvil/shared";
import { AnvilError } from "../lib/errors.js";
import { truncate } from "../lib/text.js";
import type { Runtime } from "../runtime/runtime.js";
import type { Workspace } from "../lib/workspace.js";

export interface PlanRequest {
  task: string;
  workspace?: Workspace;
  /** Optional context — a project profile, related memory facts, etc. */
  context?: string;
}

export interface Planner {
  plan(request: PlanRequest): Promise<Plan>;
}

// ---------------------------------------------------------------------------
// HeuristicPlanner — deterministic, offline.
// ---------------------------------------------------------------------------

const SURFACE_HINTS: Record<PlanSurface, RegExp> = {
  frontend: /\b(frontend|front-end|ui|page|component|design|screen|view|layout|client|react|vue|svelte)\b/i,
  backend: /\b(backend|back-end|api|service|server|endpoint|database|db|sql|microservice)\b/i,
  shared: /\b(schema|types?|contract|interface|model|shared)\b/i,
  infra: /\b(deploy|docker|ci|cd|infra|kubernetes|k8s|terraform|pipeline)\b/i,
};

const SURFACE_ORDER: readonly PlanSurface[] = ["infra", "shared", "backend", "frontend"];

function detectSurfaces(task: string): PlanSurface[] {
  return SURFACE_ORDER.filter((surface) => SURFACE_HINTS[surface].test(task));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class HeuristicPlanner implements Planner {
  plan(request: PlanRequest): Promise<Plan> {
    const surfaces = detectSurfaces(request.task);
    const epic: PlanNode = {
      id: "epic",
      title: truncate(request.task, 80),
      description: request.task,
      kind: "epic",
      dependencies: [],
      status: "pending",
    };
    const nodes: PlanNode[] = [epic];

    if (surfaces.length === 0) {
      nodes.push({
        id: "implement",
        title: "Implement",
        description: request.task,
        kind: "task",
        dependencies: ["epic"],
        status: "pending",
      });
    } else {
      let previous = "epic";
      for (const surface of surfaces) {
        nodes.push({
          id: surface,
          title: `${capitalize(surface)} work`,
          description: `The ${surface} portion of: ${request.task}`,
          kind: "task",
          dependencies: [previous],
          status: "pending",
          surface,
        });
        previous = surface;
      }
    }

    const lastTask = nodes[nodes.length - 1]?.id ?? "epic";
    nodes.push({
      id: "verify",
      title: "Verify end-to-end",
      description: "Run the test suite and confirm the build is green.",
      kind: "step",
      dependencies: [lastTask],
      status: "pending",
    });

    return Promise.resolve({ goal: request.task, nodes });
  }
}

// ---------------------------------------------------------------------------
// LlmPlanner — drives the agent loop for richer plans.
// ---------------------------------------------------------------------------

export function buildPlanPrompt(request: PlanRequest): string {
  return [
    "You are Anvil's planner. Decompose the task into a small, executable JSON plan.",
    "",
    `Task: ${request.task}`,
    request.context ? `Project context: ${request.context}` : "",
    "",
    "Output ONLY a JSON object — no prose, no markdown fences — matching this shape:",
    "{",
    '  "goal": "<one-line goal>",',
    '  "nodes": [',
    "    {",
    '      "id": "<kebab-case-slug>",',
    '      "title": "<short title>",',
    '      "description": "<one line>",',
    '      "kind": "epic" | "task" | "step",',
    '      "dependencies": ["<other id>", ...],',
    '      "surface": "frontend" | "backend" | "shared" | "infra"  (optional)',
    "    }",
    "  ]",
    "}",
    "",
    "Keep it small (3 to 8 nodes). Use kebab-case ids.",
    "Backend nodes should come before any frontend that consumes them.",
    'Finish with a final "verify" step that depends on the last task.',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Extract the first JSON object from a possibly-prosey response. */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const haystack = fence?.[1] ?? text;
  const start = haystack.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < haystack.length; i++) {
    const character = haystack[i];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(haystack.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export class LlmPlanner implements Planner {
  constructor(private readonly runtime: Runtime) {}

  async plan(request: PlanRequest): Promise<Plan> {
    if (this.runtime.running) {
      throw new AnvilError("RUNTIME_ERROR", "The planner's runtime is already executing a run.");
    }
    const result = await this.runtime.run(newJobId(), buildPlanPrompt(request));
    if (!result.ok) {
      throw new AnvilError("RUNTIME_ERROR", `Planner run failed: ${result.error ?? "no result"}`);
    }
    const parsed = extractJson(result.result);
    if (parsed === undefined) {
      throw new AnvilError(
        "INVALID_INPUT",
        "The planner returned no JSON object — try again or fall back to the heuristic planner.",
      );
    }
    try {
      return planSchema.parse(parsed) as Plan;
    } catch (err) {
      throw new AnvilError("INVALID_INPUT", "The planner returned JSON that does not match the plan schema.", {
        cause: err,
        details: { received: parsed },
      });
    }
  }
}
