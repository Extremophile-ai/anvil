/**
 * The self-healer ties the four recovery layers into one envelope around any
 * unit of risky work: snapshot a checkpoint, run with retry-and-backoff, and on
 * failure roll back, classify, count the strike, and escalate once stuck.
 */
import type { JobId } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import { AnvilError, errorMessage } from "../lib/errors.js";
import { type Escalator, EscalationError } from "./escalation.js";
import { type Checkpoint, GitCheckpoints } from "./git-checkpoints.js";
import { classifyError, StrikeBoard } from "./recovery.js";
import { type RetryPolicy, withRetry } from "./retry.js";

export interface SelfHealerDeps {
  bus: EventBus;
  /** When provided, work is checkpointed and rolled back on failure. */
  git?: GitCheckpoints;
  /** Shared strike board; one is created if omitted. */
  strikes?: StrikeBoard;
  /** Invoked when the harness gives up and needs a human. */
  escalate?: Escalator;
}

export interface HealOptions {
  jobId: JobId;
  /** Human-readable name of the step being healed. */
  label: string;
  /** Snapshot a checkpoint first. Default true (when a git repo is available). */
  checkpoint?: boolean;
  retry?: Partial<RetryPolicy>;
  /** Key for strike counting across separate runs. Defaults to `label`. */
  strikeKey?: string;
}

export class SelfHealer {
  private readonly bus: EventBus;
  private readonly git: GitCheckpoints | undefined;
  private readonly strikes: StrikeBoard;
  private readonly escalate: Escalator | undefined;

  constructor(deps: SelfHealerDeps) {
    this.bus = deps.bus;
    this.git = deps.git;
    this.strikes = deps.strikes ?? new StrikeBoard();
    this.escalate = deps.escalate;
  }

  /** Run risky work under the full self-healing envelope. */
  async run<T>(options: HealOptions, work: (attempt: number) => Promise<T>): Promise<T> {
    const { jobId, label } = options;
    const strikeKey = options.strikeKey ?? label;

    let checkpoint: Checkpoint | undefined;
    if (this.git && options.checkpoint !== false && (await this.git.isRepo())) {
      checkpoint = await this.git.checkpoint(label);
      this.bus.publish(jobId, "checkpoint.created", "debug", `Checkpoint before "${label}".`, {
        checkpointId: checkpoint.id,
      });
    }

    try {
      const outcome = await withRetry(work, options.retry, (err, attempt, delayMs) => {
        this.bus.publish(
          jobId,
          "healing.retry",
          "warn",
          `Retry ${attempt} of "${label}" in ${delayMs}ms: ${errorMessage(err)}`,
          { attempt, delayMs },
        );
      });
      this.strikes.clear(strikeKey);
      return outcome.value;
    } catch (err) {
      const diagnosis = classifyError(err);
      const strikes = this.strikes.record(strikeKey);

      if (checkpoint && this.git) {
        await this.git.restore(checkpoint.id);
        this.bus.publish(jobId, "checkpoint.restored", "warn", `Rolled "${label}" back to its checkpoint.`, {
          checkpointId: checkpoint.id,
        });
      }

      if (diagnosis.action === "escalate" || this.strikes.exceeded(strikeKey)) {
        this.bus.publish(
          jobId,
          "healing.escalated",
          "error",
          `Escalating "${label}" after ${strikes} attempt(s): ${diagnosis.reason}`,
          { strikes, reason: diagnosis.reason },
        );
        if (this.escalate) {
          await this.escalate({ jobId, label, error: err, strikes, history: [diagnosis.reason] });
        }
        throw new EscalationError(label, strikes, err);
      }

      throw err instanceof Error ? err : new AnvilError("RUNTIME_ERROR", errorMessage(err));
    }
  }
}
