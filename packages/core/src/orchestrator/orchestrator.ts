/**
 * The orchestrator — Anvil's end-to-end build engine.
 *
 * Given a task it: persists a job → plans it (via a {@link Planner}) → executes
 * the plan node by node in dependency order, running the agent for each node
 * under {@link SelfHealer} → optionally delivers a feature branch and PR →
 * reflects on the run, distilling lessons into memory. Real-time steering is
 * supported via {@link steer} and {@link interrupt}.
 */
import type { JobId, JobRecord, Plan, PlanNode, RunResult } from "@anvil/shared";
import { type Deliverer } from "../delivery/deliverer.js";
import type { EventBus } from "../events/bus.js";
import { SelfHealer } from "../healing/healer.js";
import type { RetryPolicy } from "../healing/retry.js";
import { AnvilError, errorMessage } from "../lib/errors.js";
import { slugify } from "../lib/text.js";
import type { Workspace } from "../lib/workspace.js";
import type { LearningLoop } from "../learning/loop.js";
import type { MemoryManager } from "../memory/manager.js";
import { Runtime, type RuntimeConfig } from "../runtime/runtime.js";
import type { SkillLibrary } from "../skills/library.js";
import type { Skill } from "../skills/types.js";
import type { StateStore } from "../state/store.js";
import { createAnvilMcpServer } from "../tools/mcp-bridge.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { GoalAssessment, GoalDefinition, GoalEvaluator } from "./goal.js";
import { JobStore } from "./job-store.js";
import { topologicalOrder, updateNode } from "./plan.js";
import { HeuristicPlanner, type Planner } from "./planner.js";
import { buildNodePrompt, buildSystemPrompt } from "./prompts.js";

/** The subset of {@link Runtime} the orchestrator depends on — also a seam for tests. */
export interface RuntimeLike {
  readonly running: boolean;
  run(jobId: JobId, task: string): Promise<RunResult>;
  steer(text: string): void;
  interrupt(): Promise<void>;
}

export type RuntimeFactory = (config: RuntimeConfig) => RuntimeLike;

export interface OrchestratorDeps {
  workspace: Workspace;
  store: StateStore;
  bus: EventBus;
  /** Default: {@link HeuristicPlanner}. Override with an LLM planner for production. */
  planner?: Planner;
  /** Default: a {@link SelfHealer} with no git (no checkpoints). */
  healer?: SelfHealer;
  /** When provided, top-K memory facts are recalled and threaded into node prompts. */
  memory?: MemoryManager;
  /** When provided, the orchestrator reflects on the run at the end. */
  learning?: LearningLoop;
  /** When provided and not skipped, the orchestrator opens a feature branch and commits. */
  deliverer?: Deliverer;
  /** Default factory: `new Runtime(...)`. Tests inject a fake. */
  runtimeFactory?: RuntimeFactory;
  /** Default model. Defaults to "opus". */
  model?: string;
  /**
   * When provided, Anvil's tools are exposed to the agent as an in-process MCP
   * server (`mcp__anvil__*`) and the agent's raw write tools are blocked, so
   * every change runs through Anvil's audit + guardrails.
   */
  toolRegistry?: ToolRegistry;
  /**
   * Tools the agent cannot use. Defaults to the raw SDK write tools when
   * `toolRegistry` is provided, so the agent must use Anvil's `write_file` etc.
   */
  disallowedTools?: string[];
  /**
   * Goal-mode judge. Required only for {@link Orchestrator.buildToward}; single
   * builds (`build`) ignore it.
   */
  evaluator?: GoalEvaluator;
  /**
   * When provided, validated skills matching the task are surfaced into the
   * agent's system prompt so the agent can reuse them instead of reinventing.
   */
  skills?: SkillLibrary;
  /**
   * Maximum number of validated skills to surface in the system prompt.
   * Defaults to 5.
   */
  maxSurfacedSkills?: number;
}

export type DeliveryMode = "none" | "branch" | "push" | "pr";

export interface BuildOptions {
  /** How far to take delivery. "none" = no git ops. "branch" = create branch + commit
   *  (no push). "push" = also push to remote. "pr" = also open a PR.
   *  Default: "branch" when a deliverer is provided and the workspace is a repo. */
  delivery?: DeliveryMode;
  /** Skip the reflection step. Default false (reflect when learning is provided). */
  skipReflection?: boolean;
  /** Override the SDK permission mode for agent runs. */
  permissionMode?: NonNullable<RuntimeConfig["permissionMode"]>;
  /** Override the model for this build. */
  model?: string;
  /** Override the maximum number of agent turns per node. */
  maxTurns?: number;
  /** Retry policy for each node. */
  retry?: Partial<RetryPolicy>;
  /** Per-build override of the disallowed agent tools. */
  disallowedTools?: string[];
  /** Per-build override of which Claude Code setting sources are inherited. */
  settingSources?: RuntimeConfig["settingSources"];
}

export interface BuildResult {
  job: JobRecord;
  plan: Plan;
  branch?: string;
  pullRequestUrl?: string;
  corrections: string[];
}

export interface GoalResult extends BuildResult {
  /** The judge's last verdict + how many iterations it took. */
  goal: GoalAssessment & { iterations: number };
  /** One BuildResult per iteration, oldest first. */
  history: BuildResult[];
}

const DEFAULT_DISALLOWED_WHEN_BRIDGED: readonly string[] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const DEFAULT_MAX_SURFACED_SKILLS = 5;

export class Orchestrator {
  private readonly bus: EventBus;
  private readonly workspace: Workspace;
  private readonly store: StateStore;
  private readonly planner: Planner;
  private readonly healer: SelfHealer;
  private readonly memory: MemoryManager | undefined;
  private readonly learning: LearningLoop | undefined;
  private readonly deliverer: Deliverer | undefined;
  private readonly runtimeFactory: RuntimeFactory;
  private readonly model: string;
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly disallowedTools: string[] | undefined;
  private readonly evaluator: GoalEvaluator | undefined;
  private readonly skills: SkillLibrary | undefined;
  private readonly maxSurfacedSkills: number;

  private activeRuntime: RuntimeLike | undefined;
  private activeJobId: JobId | undefined;
  private corrections: string[] = [];

  constructor(deps: OrchestratorDeps) {
    this.bus = deps.bus;
    this.workspace = deps.workspace;
    this.store = deps.store;
    this.planner = deps.planner ?? new HeuristicPlanner();
    this.healer = deps.healer ?? new SelfHealer({ bus: deps.bus });
    this.memory = deps.memory;
    this.learning = deps.learning;
    this.deliverer = deps.deliverer;
    this.runtimeFactory =
      deps.runtimeFactory ?? ((config) => new Runtime({ bus: deps.bus, config }) as RuntimeLike);
    this.model = deps.model ?? "opus";
    this.toolRegistry = deps.toolRegistry;
    this.disallowedTools =
      deps.disallowedTools ?? (deps.toolRegistry ? [...DEFAULT_DISALLOWED_WHEN_BRIDGED] : undefined);
    this.evaluator = deps.evaluator;
    this.skills = deps.skills;
    this.maxSurfacedSkills = deps.maxSurfacedSkills ?? DEFAULT_MAX_SURFACED_SKILLS;
  }

  /** True while a build is in progress. */
  get running(): boolean {
    return this.activeJobId !== undefined;
  }

  /** Inject a correction into the running build. */
  steer(text: string): void {
    if (!this.activeJobId) {
      throw new AnvilError("NO_ACTIVE_RUN", "No build is in progress to steer.");
    }
    this.corrections.push(text);
    this.activeRuntime?.steer(text);
    this.bus.publish(this.activeJobId, "steering.received", "info", text);
  }

  async interrupt(): Promise<void> {
    if (this.activeRuntime) await this.activeRuntime.interrupt();
  }

  /** Run a task end-to-end. Returns the final job + plan + delivery info. */
  async build(task: string, options: BuildOptions = {}): Promise<BuildResult> {
    if (this.running) {
      throw new AnvilError("RUNTIME_ERROR", "This orchestrator is already building.");
    }
    const jobs = new JobStore(this.store);
    const job = jobs.create(task);
    this.activeJobId = job.id;
    this.corrections = [];
    this.bus.publish(job.id, "run.started", "info", `Build started: ${task}`, { task });

    try {
      jobs.update(job.id, { status: "planning" });
      const context = await this.recallContext(task);
      const plan = await this.planner.plan({ task, workspace: this.workspace, context });
      jobs.update(job.id, { status: "running", plan });

      const mcpServers = this.toolRegistry
        ? {
            anvil: createAnvilMcpServer({
              registry: this.toolRegistry,
              jobId: job.id,
              workspace: this.workspace,
              bus: this.bus,
            }),
          }
        : undefined;
      const disallowedTools = options.disallowedTools ?? this.disallowedTools;

      const surfacedSkills = this.recallSkills(task);
      if (surfacedSkills.length > 0) {
        this.bus.publish(
          job.id,
          "skill.surfaced",
          "info",
          `Surfacing ${surfacedSkills.length} validated skill(s) into the agent prompt.`,
          { skills: surfacedSkills.map((s) => s.name) },
        );
      }

      const runtimeConfig: RuntimeConfig = {
        cwd: this.workspace.root,
        model: options.model ?? this.model,
        permissionMode: options.permissionMode ?? "bypassPermissions",
        systemPrompt: buildSystemPrompt({ skills: surfacedSkills }),
        // The orchestrator owns the autonomous instruction set: it inherits
        // workspace conventions ("project") but never user-global Claude Code
        // settings, which carry interactive-mode rules like "seek approval
        // before file edits" that would block automation.
        settingSources: options.settingSources ?? ["project"],
      };
      if (options.maxTurns !== undefined) runtimeConfig.maxTurns = options.maxTurns;
      if (mcpServers) runtimeConfig.mcpServers = mcpServers;
      if (disallowedTools && disallowedTools.length > 0) runtimeConfig.disallowedTools = disallowedTools;

      const runtime = this.runtimeFactory(runtimeConfig);
      this.activeRuntime = runtime;

      const { plan: finalPlan, allOk } = await this.executePlan(job.id, task, plan, context, runtime, jobs, options);

      let branch: string | undefined;
      let pullRequestUrl: string | undefined;
      if (allOk) {
        const delivery = await this.deliver(task, job.id, options);
        branch = delivery.branch;
        pullRequestUrl = delivery.pullRequestUrl;
      }

      if (!options.skipReflection && this.learning) {
        await this.learning.reflect({
          jobId: job.id,
          task,
          outcome: allOk ? "success" : "failure",
          corrections: [...this.corrections],
        });
      }

      const finalJob = jobs.update(job.id, {
        status: allOk ? "succeeded" : "failed",
        plan: finalPlan,
        result: allOk ? "Build completed." : "Build failed; see plan node statuses.",
      });
      this.bus.publish(
        job.id,
        allOk ? "run.finished" : "run.failed",
        allOk ? "info" : "error",
        allOk ? "Build complete." : "Build failed.",
      );

      const result: BuildResult = { job: finalJob, plan: finalPlan, corrections: [...this.corrections] };
      if (branch !== undefined) result.branch = branch;
      if (pullRequestUrl !== undefined) result.pullRequestUrl = pullRequestUrl;
      return result;
    } finally {
      this.activeRuntime = undefined;
      this.activeJobId = undefined;
    }
  }

  /**
   * Goal-mode: run iterations of {@link build} until a {@link GoalEvaluator}
   * reports the condition is satisfied, or `maxIterations` is reached. Mirrors
   * Claude Code's `/goal` semantics, with the addition of optional verifier
   * commands (e.g. `pnpm test`).
   */
  async buildToward(
    initialTask: string,
    goal: GoalDefinition,
    options: BuildOptions = {},
  ): Promise<GoalResult> {
    if (!this.evaluator) {
      throw new AnvilError(
        "INVALID_INPUT",
        "buildToward needs a GoalEvaluator. Pass `evaluator` to the Orchestrator.",
      );
    }
    const maxIterations = goal.maxIterations ?? 5;
    let task = initialTask;
    const history: BuildResult[] = [];
    let lastAssessment: GoalAssessment | undefined;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const buildResult = await this.build(task, options);
      history.push(buildResult);
      if (buildResult.job.status !== "succeeded") {
        lastAssessment = {
          satisfied: false,
          reason: `Iteration ${iteration} build did not succeed (status: ${buildResult.job.status}).`,
        };
        break;
      }
      const summary =
        buildResult.job.result ??
        buildResult.plan.nodes.map((node) => `${node.id}: ${node.result ?? "(no result)"}`).join("; ");
      const assessment = await this.evaluator.evaluate(goal, {
        task: initialTask,
        iteration,
        lastResult: summary,
      });
      lastAssessment = assessment;
      this.bus.publish(
        buildResult.job.id,
        "eval.run",
        assessment.satisfied ? "info" : "warn",
        `Goal ${assessment.satisfied ? "met" : "not yet met"}: ${assessment.reason}`,
        { iteration, condition: goal.condition },
      );
      if (assessment.satisfied) break;
      task =
        `${initialTask}\n\n` +
        `Iteration ${iteration} did not satisfy the goal "${goal.condition}". ` +
        `Reason: ${assessment.reason}. Continue working toward it.`;
    }

    if (this.memory) {
      await this.memory.remember({
        type: "project",
        description: `Goal: ${goal.condition.slice(0, 80)}`,
        body: [
          `Goal: ${goal.condition}`,
          `Achieved: ${lastAssessment?.satisfied ?? false}`,
          `Iterations: ${history.length}`,
          `Final reason: ${lastAssessment?.reason ?? "(none)"}`,
        ].join("\n"),
        tags: ["goal"],
      });
    }

    const final = history[history.length - 1];
    if (!final) {
      throw new AnvilError("RUNTIME_ERROR", "buildToward made no progress (no iterations ran).");
    }
    return {
      ...final,
      goal: {
        ...(lastAssessment ?? { satisfied: false, reason: "No iterations ran." }),
        iterations: history.length,
      },
      history,
    };
  }

  // --- internals -----------------------------------------------------------

  private async recallContext(task: string): Promise<string | undefined> {
    if (!this.memory) return undefined;
    const hits = await this.memory.recall(task, { topK: 3 });
    if (hits.length === 0) return undefined;
    return hits.map((hit) => `- ${hit.fact.description}: ${hit.fact.body}`).join("\n");
  }

  /**
   * Pull the best-matching validated skills from the library for this task.
   * Unvalidated skills are filtered out so the agent never sees skills that
   * failed validation.
   */
  private recallSkills(task: string): Skill[] {
    if (!this.skills) return [];
    return this.skills
      .search(task)
      .filter((skill) => skill.validated)
      .slice(0, this.maxSurfacedSkills);
  }

  private async executePlan(
    jobId: JobId,
    task: string,
    initial: Plan,
    context: string | undefined,
    runtime: RuntimeLike,
    jobs: JobStore,
    options: BuildOptions,
  ): Promise<{ plan: Plan; allOk: boolean }> {
    let plan = initial;
    for (const node of topologicalOrder(initial)) {
      if (node.status !== "pending") continue;
      if (node.kind === "epic") {
        plan = updateNode(plan, node.id, { status: "done", result: "Epic — children executed below." });
        jobs.update(jobId, { plan });
        continue;
      }
      plan = updateNode(plan, node.id, { status: "running" });
      jobs.update(jobId, { plan });
      this.bus.publish(jobId, "task.started", "info", `Step: ${node.title}`, { nodeId: node.id });

      const outcome = await this.runNode(jobId, task, node, plan, context, runtime, options);
      plan = updateNode(plan, node.id, outcome);
      jobs.update(jobId, { plan });
      this.bus.publish(
        jobId,
        "task.finished",
        outcome.status === "done" ? "info" : "error",
        `Step ${outcome.status}: ${node.title}`,
        { nodeId: node.id },
      );
      if (outcome.status === "failed") return { plan, allOk: false };
    }
    return { plan, allOk: true };
  }

  private async runNode(
    jobId: JobId,
    task: string,
    node: PlanNode,
    plan: Plan,
    context: string | undefined,
    runtime: RuntimeLike,
    options: BuildOptions,
  ): Promise<{ status: "done" | "failed"; result: string }> {
    const prompt = buildNodePrompt({ task, node, plan, ...(context !== undefined ? { context } : {}) });
    try {
      const result = await this.healer.run(
        {
          jobId,
          label: node.id,
          ...(options.retry !== undefined ? { retry: options.retry } : {}),
        },
        async () => {
          if (runtime.running) {
            throw new AnvilError("RUNTIME_ERROR", "The runtime is busy executing another step.");
          }
          return runtime.run(jobId, prompt);
        },
      );
      if (!result.ok) return { status: "failed", result: result.error ?? "agent reported failure" };
      const summary = result.result.trim();
      return { status: "done", result: summary.length > 0 ? summary : "(no summary)" };
    } catch (err) {
      return { status: "failed", result: errorMessage(err) };
    }
  }

  private async deliver(
    task: string,
    jobId: JobId,
    options: BuildOptions,
  ): Promise<{ branch?: string; pullRequestUrl?: string }> {
    const mode = options.delivery ?? (this.deliverer ? "branch" : "none");
    if (mode === "none" || !this.deliverer) return {};
    if (!(await this.deliverer.isRepo())) return {};

    const branch = `anvil/${slugify(task, 40)}-${jobId.slice(-6)}`;
    await this.deliverer.startBranch(branch);
    if (!(await this.deliverer.isClean())) {
      await this.deliverer.commit(`anvil: ${task}`);
    }
    if (mode === "branch") return { branch };

    await this.deliverer.push();
    if (mode === "push") return { branch };

    const pullRequestUrl = await this.deliverer.openPullRequest({
      title: `anvil: ${task}`,
      body: `Built by Anvil for job \`${jobId}\`.`,
    });
    return { branch, pullRequestUrl };
  }
}
