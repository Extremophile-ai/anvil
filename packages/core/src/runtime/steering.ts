/**
 * The steering channel — an open-ended async stream of user messages fed to the
 * agent. The initial task is pushed first; corrections are pushed mid-run. The
 * channel stays open (keeping the agent in the SDK's streaming-input mode, which
 * is what makes interruption and mid-task steering possible) until `close()`.
 */
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AnvilError } from "../lib/errors.js";

function userMessage(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

export class SteeringChannel implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  /** Messages buffered but not yet consumed by the agent. */
  pending(): number {
    return this.queue.length;
  }

  /** Push a message — the initial task, or a mid-run correction. */
  push(text: string): void {
    if (this.closed) {
      throw new AnvilError("STEERING_CLOSED", "Cannot steer: the run has already finished.");
    }
    const message = userMessage(text);
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: message, done: false });
    } else {
      this.queue.push(message);
    }
  }

  /** End the stream; the agent run completes after the last buffered message. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      const next = this.queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
        this.waiting = resolve;
      });
      if (result.done) return;
      yield result.value;
    }
  }
}
