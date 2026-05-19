/**
 * Branded identifier types and their generators.
 *
 * Branding gives each id its own nominal type, so a `JobId` can never be passed
 * where a `TaskId` is expected even though both are strings at runtime.
 */
import { randomUUID } from "node:crypto";

declare const __brand: unique symbol;

/** A nominal (branded) type — `T` at runtime, distinct at compile time. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type JobId = Brand<string, "JobId">;
export type TaskId = Brand<string, "TaskId">;
export type EventId = Brand<string, "EventId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type CheckpointId = Brand<string, "CheckpointId">;
export type MemoryId = Brand<string, "MemoryId">;
export type ApprovalToken = Brand<string, "ApprovalToken">;

function prefixed<T extends string>(prefix: string): T {
  return `${prefix}_${randomUUID()}` as T;
}

export const newJobId = (): JobId => prefixed<JobId>("job");
export const newTaskId = (): TaskId => prefixed<TaskId>("task");
export const newEventId = (): EventId => prefixed<EventId>("evt");
export const newToolCallId = (): ToolCallId => prefixed<ToolCallId>("tc");
export const newCheckpointId = (): CheckpointId => prefixed<CheckpointId>("ckpt");
export const newMemoryId = (): MemoryId => prefixed<MemoryId>("mem");
export const newApprovalToken = (): ApprovalToken => prefixed<ApprovalToken>("apt");
