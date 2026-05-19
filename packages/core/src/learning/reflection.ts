/**
 * Reflection — the post-mortem pass. After a run, a distiller turns the task,
 * its outcome, and the corrections into lessons; the reflector writes those
 * lessons into memory so the next run starts wiser.
 */
import type { MemoryFact } from "@anvil/shared";
import type { EventBus } from "../events/bus.js";
import { truncate } from "../lib/text.js";
import type { MemoryManager } from "../memory/manager.js";
import type { Distiller, Lesson, ReflectionInput } from "./types.js";

/**
 * A deterministic distiller — corrections become feedback lessons, a failed
 * outcome becomes a post-mortem. No model call, so it always works offline.
 */
export class HeuristicDistiller implements Distiller {
  distill(input: ReflectionInput): Promise<Lesson[]> {
    const lessons: Lesson[] = [];
    for (const correction of input.corrections) {
      lessons.push({
        description: `Correction: ${truncate(correction, 70)}`,
        body: `While working on "${input.task}", the user corrected the harness: "${correction}". Apply this from now on.`,
        type: "feedback",
        tags: ["correction"],
      });
    }
    if (input.outcome === "failure") {
      const notes = (input.notes ?? []).join("; ") || "no further detail";
      lessons.push({
        description: `Post-mortem: ${truncate(input.task, 60)}`,
        body: `The task "${input.task}" failed. Notes: ${notes}. Re-approach it more carefully next time.`,
        type: "project",
        tags: ["post-mortem"],
      });
    }
    return Promise.resolve(lessons);
  }
}

export interface ReflectionResult {
  lessons: Lesson[];
  remembered: MemoryFact[];
}

export interface ReflectorDeps {
  distiller: Distiller;
  memory: MemoryManager;
  bus?: EventBus;
}

export class Reflector {
  constructor(private readonly deps: ReflectorDeps) {}

  /** Distil lessons from a run and commit them to memory. */
  async reflect(input: ReflectionInput): Promise<ReflectionResult> {
    const lessons = await this.deps.distiller.distill(input);
    const remembered: MemoryFact[] = [];
    for (const lesson of lessons) {
      remembered.push(
        await this.deps.memory.remember({
          description: lesson.description,
          body: lesson.body,
          type: lesson.type,
          tags: lesson.tags,
        }),
      );
    }
    this.deps.bus?.publish(
      input.jobId,
      "reflection.completed",
      "info",
      `Reflection distilled ${lessons.length} lesson(s) into memory.`,
      { lessons: lessons.length },
    );
    return { lessons, remembered };
  }
}
