/**
 * The agent loop. Wraps the Claude Agent SDK's `query()` in streaming-input
 * mode, so a run can be steered (corrections injected) and interrupted while it
 * is still working. Every SDK message is mapped to an AnvilEvent on the bus.
 */
import { query, type Options, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { JobId, RunResult } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import { AnvilError, errorMessage } from "../lib/errors.js";
import { SteeringChannel } from "./steering.js";

/** Default model — the `opus` alias always resolves to the current Claude Opus. */
export const DEFAULT_MODEL = "opus";

export interface RuntimeConfig {
  /** Working directory the agent operates in. */
  cwd: string;
  /** Model id or alias. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  systemPrompt?: string;
  permissionMode?: NonNullable<Options["permissionMode"]>;
  maxTurns?: number;
  mcpServers?: Options["mcpServers"];
  canUseTool?: Options["canUseTool"];
  hooks?: Options["hooks"];
  settingSources?: Options["settingSources"];
}

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

/** A loosely-typed view of an assistant content block, resilient to SDK drift. */
interface RawBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

export class Runtime {
  private readonly bus: EventBus;
  private readonly config: RuntimeConfig;

  private channel: SteeringChannel | null = null;
  private activeQuery: Query | null = null;
  private jobId: JobId | null = null;
  private interrupted = false;

  constructor(deps: { bus: EventBus; config: RuntimeConfig }) {
    this.bus = deps.bus;
    this.config = deps.config;
  }

  /** True while a run is in progress. */
  get running(): boolean {
    return this.channel !== null;
  }

  /** Run a task to completion, returning its result. */
  async run(jobId: JobId, task: string): Promise<RunResult> {
    if (this.running) {
      throw new AnvilError("RUNTIME_ERROR", "This runtime is already executing a run.");
    }
    const startedAt = Date.now();
    this.jobId = jobId;
    this.interrupted = false;

    const channel = new SteeringChannel();
    this.channel = channel;
    channel.push(task);

    this.bus.publish(jobId, "run.started", "info", "Run started.", {
      task,
      model: this.config.model ?? DEFAULT_MODEL,
      cwd: this.config.cwd,
    });

    const running = query({ prompt: channel, options: this.buildOptions() });
    this.activeQuery = running;

    let last: ResultMessage | undefined;
    try {
      for await (const message of running) {
        this.handleMessage(jobId, message);
        if (message.type === "result") {
          last = message;
          // A steered correction will produce another result — wait for it.
          if (channel.pending() === 0) break;
        }
      }
    } catch (err) {
      return this.finish(jobId, startedAt, undefined, errorMessage(err));
    } finally {
      channel.close();
      this.channel = null;
      this.activeQuery = null;
    }
    return this.finish(jobId, startedAt, last);
  }

  /** Inject a correction into the running agent. */
  steer(text: string): void {
    if (!this.channel || !this.jobId) {
      throw new AnvilError("NO_ACTIVE_RUN", "Cannot steer: no run is in progress.");
    }
    this.channel.push(text);
    this.bus.publish(this.jobId, "steering.received", "info", text);
  }

  /** Stop the current agent turn. */
  async interrupt(): Promise<void> {
    this.interrupted = true;
    if (this.activeQuery) await this.activeQuery.interrupt();
    if (this.jobId) this.bus.publish(this.jobId, "runtime.interrupted", "warn", "Run interrupted.");
  }

  /** Switch the model for subsequent turns of the running agent. */
  async setModel(model?: string): Promise<void> {
    if (this.activeQuery) await this.activeQuery.setModel(model);
  }

  private buildOptions(): Options {
    const options: Options = {
      cwd: this.config.cwd,
      model: this.config.model ?? DEFAULT_MODEL,
      includePartialMessages: false,
      stderr: (data: string) => {
        if (this.jobId) {
          this.bus.publish(this.jobId, "log", "debug", data.trimEnd(), { source: "sdk" });
        }
      },
    };
    if (this.config.systemPrompt !== undefined) options.systemPrompt = this.config.systemPrompt;
    if (this.config.permissionMode !== undefined) options.permissionMode = this.config.permissionMode;
    if (this.config.maxTurns !== undefined) options.maxTurns = this.config.maxTurns;
    if (this.config.mcpServers !== undefined) options.mcpServers = this.config.mcpServers;
    if (this.config.canUseTool !== undefined) options.canUseTool = this.config.canUseTool;
    if (this.config.hooks !== undefined) options.hooks = this.config.hooks;
    if (this.config.settingSources !== undefined) options.settingSources = this.config.settingSources;
    return options;
  }

  private handleMessage(jobId: JobId, message: SDKMessage): void {
    switch (message.type) {
      case "assistant": {
        const blocks = message.message.content as unknown as RawBlock[];
        for (const block of blocks) {
          if (block.type === "text" && block.text) {
            this.bus.publish(jobId, "assistant.text", "info", block.text);
          } else if (block.type === "thinking" && block.thinking) {
            this.bus.publish(jobId, "assistant.thinking", "debug", block.thinking);
          } else if (block.type === "tool_use") {
            this.bus.publish(jobId, "tool.use", "info", `Tool call: ${block.name ?? "unknown"}`, {
              tool: block.name,
              input: block.input,
              toolUseId: block.id,
            });
          }
        }
        break;
      }
      case "user": {
        if (message.tool_use_result !== undefined) {
          this.bus.publish(jobId, "tool.result", "debug", "Tool result received.", {
            result: message.tool_use_result,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private finish(
    jobId: JobId,
    startedAt: number,
    last: ResultMessage | undefined,
    error?: string,
  ): RunResult {
    const durationMs = Date.now() - startedAt;
    const raw = last as unknown as
      | { subtype?: string; result?: unknown; num_turns?: number; total_cost_usd?: number; is_error?: boolean }
      | undefined;

    const ok =
      error === undefined && raw !== undefined && raw.subtype === "success" && raw.is_error !== true;
    const resultText = typeof raw?.result === "string" ? raw.result : "";
    const failure =
      error ??
      (last === undefined
        ? "Run ended without a result message."
        : ok
          ? undefined
          : "The agent reported an error result.");

    const result: RunResult = {
      jobId,
      ok,
      result: resultText,
      numTurns: raw?.num_turns ?? 0,
      durationMs,
      costUsd: raw?.total_cost_usd ?? 0,
      interrupted: this.interrupted,
    };
    if (failure !== undefined) result.error = failure;

    this.bus.publish(
      jobId,
      ok ? "run.finished" : "run.failed",
      ok ? "info" : "error",
      ok ? "Run finished." : `Run failed: ${failure ?? "unknown error"}`,
      { numTurns: result.numTurns, costUsd: result.costUsd, durationMs },
    );
    return result;
  }
}
