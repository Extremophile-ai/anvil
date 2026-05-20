/**
 * AnvilService — the engine backing every Anvil front door (the MCP server,
 * the HTTP service, and any other transport you bolt on). Builds run
 * asynchronously: callers get a `jobId` as soon as the run has started, while
 * the build itself continues in the background.
 *
 * Pre-wires an Orchestrator with a goal-aware evaluator so `/goal`-style
 * iterations work without per-call setup; `CommandGoalEvaluator` is added on
 * the fly when a goal carries `verify` commands.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  JobId,
  JobRecord,
  MemoryFact,
  MemoryScope,
  RecallResult,
} from "@anvil/shared";
import { Deliverer } from "./delivery/deliverer.js";
import { createEmbedder } from "./embeddings/index.js";
import { EventBus } from "./events/bus.js";
import {
  CommandGoalEvaluator,
  CompositeGoalEvaluator,
  type GoalAssessment,
  type GoalContext,
  type GoalDefinition,
  type GoalEvaluator,
  LlmGoalEvaluator,
} from "./orchestrator/goal.js";
import type { IngestionResult } from "./ingestion/types.js";
import { WorkspaceIngestor } from "./ingestion/ingestor.js";
import { LearningLoop } from "./learning/loop.js";
import { createLogFailureTool } from "./learning/log-failure-tool.js";
import { AnvilError } from "./lib/errors.js";
import { JsonlLogger } from "./lib/logger.js";
import { Workspace } from "./lib/workspace.js";
import { MemoryManager } from "./memory/manager.js";
import { JobStore } from "./orchestrator/job-store.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { selectPlannerFromEnv } from "./orchestrator/planner.js";
import { Runtime } from "./runtime/runtime.js";
import { LocalSandbox } from "./sandbox/local.js";
import { createSkillTool } from "./skills/create-skill-tool.js";
import { SkillFactory } from "./skills/factory.js";
import { SkillLibrary } from "./skills/library.js";
import { StateStore } from "./state/store.js";
import { builtinTools } from "./tools/builtins/index.js";
import { ToolRegistry } from "./tools/registry.js";

/** A goal-aware evaluator: it always runs the LLM judge, and adds a
 *  CommandGoalEvaluator on the fly when the goal supplies `verify` commands. */
class SmartGoalEvaluator implements GoalEvaluator {
  constructor(
    private readonly llm: LlmGoalEvaluator,
    private readonly workspace: Workspace,
  ) {}

  evaluate(goal: GoalDefinition, context: GoalContext): Promise<GoalAssessment> {
    const evaluators: GoalEvaluator[] = [];
    if (goal.verify && goal.verify.length > 0) {
      evaluators.push(new CommandGoalEvaluator(new LocalSandbox({ workspace: this.workspace })));
    }
    evaluators.push(this.llm);
    return new CompositeGoalEvaluator(evaluators).evaluate(goal, context);
  }
}

export interface StartBuildOptions {
  goal?: GoalDefinition;
  skipDelivery?: boolean;
  skipReflection?: boolean;
  maxTurns?: number;
  model?: string;
}

export interface AnvilServiceDeps {
  workspace: Workspace;
  store: StateStore;
  bus: EventBus;
  orchestrator: Orchestrator;
  memory: MemoryManager;
  jobs: JobStore;
}

export class AnvilService {
  readonly bus: EventBus;
  readonly workspace: Workspace;
  private readonly store: StateStore;
  private readonly orchestrator: Orchestrator;
  private readonly memory: MemoryManager;
  private readonly jobs: JobStore;

  private activeJobId: JobId | undefined;

  private constructor(deps: AnvilServiceDeps) {
    this.bus = deps.bus;
    this.workspace = deps.workspace;
    this.store = deps.store;
    this.orchestrator = deps.orchestrator;
    this.memory = deps.memory;
    this.jobs = deps.jobs;
  }

  /** Build a service from a workspace path, wiring every default real backend. */
  static async create(workspaceRoot: string): Promise<AnvilService> {
    const workspace = new Workspace(workspaceRoot);
    const dataDir = join(workspace.root, ".anvil");
    mkdirSync(dataDir, { recursive: true });
    const store = new StateStore(join(dataDir, "state.db"));
    const bus = new EventBus();
    new JsonlLogger(join(dataDir, "logs", "anvil.log")).attach(bus);

    const embedder = await createEmbedder({ provider: "auto" });
    const memory = new MemoryManager({ store, embedder });
    const learning = new LearningLoop({
      store,
      memory,
      failuresPath: join(workspace.root, "failures.md"),
    });

    const toolRegistry = new ToolRegistry({ workspace, bus });
    toolRegistry.registerAll(builtinTools());
    toolRegistry.register(createLogFailureTool(learning));
    toolRegistry.register(createSkillTool(new SkillFactory({ library: new SkillLibrary(), bus })));

    const deliverer = existsSync(join(workspace.root, ".git")) ? new Deliverer({ workspace }) : undefined;

    const judgeRuntime = new Runtime({
      bus,
      config: {
        cwd: workspace.root,
        model: "haiku",
        permissionMode: "bypassPermissions",
        maxTurns: 2,
        settingSources: [],
        systemPrompt: "You are a strict goal-completion judge. Reply with JSON only.",
      },
    });
    const evaluator = new SmartGoalEvaluator(new LlmGoalEvaluator(judgeRuntime), workspace);

    const planner = selectPlannerFromEnv({ bus, cwd: workspace.root });

    const orchestrator = new Orchestrator({
      workspace,
      store,
      bus,
      memory,
      learning,
      toolRegistry,
      evaluator,
      planner,
      ...(deliverer ? { deliverer } : {}),
    });

    return new AnvilService({
      workspace,
      store,
      bus,
      orchestrator,
      memory,
      jobs: new JobStore(store),
    });
  }

  /** Inject pre-built dependencies — used by tests. */
  static fromDeps(deps: AnvilServiceDeps): AnvilService {
    return new AnvilService(deps);
  }

  /** Start a build. Resolves with a jobId as soon as the run has started; the
   *  build itself continues in the background. */
  startBuild(task: string, options: StartBuildOptions = {}): Promise<{ jobId: JobId }> {
    if (this.activeJobId) {
      throw new AnvilError(
        "RUNTIME_ERROR",
        `Anvil is already building "${this.activeJobId}". Call interrupt first or wait for it to finish.`,
      );
    }

    const buildOptions: Parameters<Orchestrator["build"]>[1] = {
      delivery: options.skipDelivery ? "none" : "branch",
      skipReflection: options.skipReflection ?? false,
    };
    if (options.maxTurns !== undefined) buildOptions.maxTurns = options.maxTurns;
    if (options.model !== undefined) buildOptions.model = options.model;

    const captured = new Promise<JobId>((resolve) => {
      const off = this.bus.on((event) => {
        if (event.kind === "run.started") {
          resolve(event.jobId);
          off();
        }
      });
    });

    const promise = options.goal
      ? this.orchestrator.buildToward(task, options.goal, buildOptions)
      : this.orchestrator.build(task, buildOptions);
    promise.finally(() => {
      this.activeJobId = undefined;
    });
    // Swallow rejection; the JobRecord will reflect the failure.
    promise.catch(() => undefined);

    return captured.then((jobId) => {
      this.activeJobId = jobId;
      return { jobId };
    });
  }

  /** Snapshot of a job's persisted status + plan. */
  getStatus(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  /** List every job, oldest first. */
  listJobs(): JobRecord[] {
    return this.jobs.list();
  }

  /** Inject a correction into the running build. */
  steer(jobId: string, text: string): { ok: true } {
    if (this.activeJobId !== jobId) {
      throw new AnvilError("INVALID_INPUT", `Job "${jobId}" is not currently running.`);
    }
    this.orchestrator.steer(text);
    return { ok: true };
  }

  async interrupt(jobId: string): Promise<{ ok: true }> {
    if (this.activeJobId !== jobId) {
      throw new AnvilError("INVALID_INPUT", `Job "${jobId}" is not currently running.`);
    }
    await this.orchestrator.interrupt();
    return { ok: true };
  }

  /** Profile + index a workspace (this service's workspace by default). */
  async ingest(dir?: string): Promise<IngestionResult> {
    const ws = dir ? new Workspace(dir) : this.workspace;
    const embedder = await createEmbedder({ provider: "auto" });
    const ingestor = new WorkspaceIngestor({ store: this.store, embedder, bus: this.bus });
    return ingestor.ingest(ws);
  }

  recall(query: string, topK?: number): Promise<RecallResult[]> {
    return this.memory.recall(query, topK !== undefined ? { topK } : {});
  }

  listMemory(scope?: MemoryScope): MemoryFact[] {
    return this.memory.list(scope);
  }

  currentJob(): JobId | undefined {
    return this.activeJobId;
  }

  close(): void {
    this.store.close();
  }
}
