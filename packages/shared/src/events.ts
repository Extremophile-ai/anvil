/**
 * The Anvil event — the single structured record that flows through the event
 * bus, is persisted as JSONL, and is read by the host assistant to follow a
 * run. Every subsystem emits events; nothing logs ad hoc.
 */
import { z } from "zod";
import { type EventId, type JobId, newEventId } from "./ids.js";

export type AnvilEventLevel = "debug" | "info" | "warn" | "error";

/**
 * The full event vocabulary. Phase 2 emits the `run.*`, `assistant.*`,
 * `tool.*`, `steering.*`, `runtime.*` and `log` kinds; later phases emit the
 * rest. Declared in full now so persisted logs never need a schema migration.
 */
export type AnvilEventKind =
  | "run.started"
  | "run.finished"
  | "run.failed"
  | "assistant.text"
  | "assistant.thinking"
  | "tool.use"
  | "tool.result"
  | "steering.received"
  | "runtime.interrupted"
  | "log"
  | "task.started"
  | "task.finished"
  | "checkpoint.created"
  | "checkpoint.restored"
  | "healing.retry"
  | "healing.escalated"
  | "approval.requested"
  | "approval.granted"
  | "memory.recalled"
  | "memory.written"
  | "mcp.connected"
  | "mcp.installed"
  | "reflection.completed"
  | "eval.run"
  | "skill.created"
  | "ingest.completed";

export interface AnvilEvent {
  id: EventId;
  jobId: JobId;
  /** ISO-8601 timestamp. */
  ts: string;
  kind: AnvilEventKind;
  level: AnvilEventLevel;
  message: string;
  data?: Record<string, unknown>;
}

/** Construct an event with a fresh id and timestamp. */
export function makeEvent(
  jobId: JobId,
  kind: AnvilEventKind,
  level: AnvilEventLevel,
  message: string,
  data?: Record<string, unknown>,
): AnvilEvent {
  const event: AnvilEvent = { id: newEventId(), jobId, ts: new Date().toISOString(), kind, level, message };
  if (data !== undefined) event.data = data;
  return event;
}

export const anvilEventSchema = z.strictObject({
  id: z.string(),
  jobId: z.string(),
  ts: z.string(),
  kind: z.string(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
