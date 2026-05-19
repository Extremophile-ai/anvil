/**
 * The event bus — a tiny synchronous pub/sub hub for AnvilEvents. Every
 * subsystem publishes here; the JSONL logger and the host-assistant feed
 * subscribe. A broken listener can never break a run.
 */
import { type AnvilEvent, type AnvilEventKind, type AnvilEventLevel, type JobId, makeEvent } from "@anvil/shared";

export type EventListener = (event: AnvilEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventListener>();

  /** Subscribe. Returns an unsubscribe function. */
  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: AnvilEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A subscriber's failure must never interrupt the run that emitted the event.
      }
    }
  }

  /** Build an event and emit it in one call. */
  publish(
    jobId: JobId,
    kind: AnvilEventKind,
    level: AnvilEventLevel,
    message: string,
    data?: Record<string, unknown>,
  ): AnvilEvent {
    const event = makeEvent(jobId, kind, level, message, data);
    this.emit(event);
    return event;
  }
}
