/**
 * Structured JSONL logging — one JSON object per line. This is the harness
 * audit trail and the source data the learning loop mines for patterns.
 */
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import type { EventBus } from "../events/bus.js";

export class JsonlLogger {
  private readonly stream: WriteStream;

  constructor(readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: "a" });
  }

  /** Append one record as a JSON line. */
  write(record: object): void {
    this.stream.write(`${JSON.stringify(record)}\n`);
  }

  /** Subscribe to a bus so every event is persisted. Returns an unsubscribe fn. */
  attach(bus: EventBus): () => void {
    return bus.on((event) => this.write(event));
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}
