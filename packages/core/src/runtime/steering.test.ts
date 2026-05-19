import { describe, expect, it } from "vitest";
import { SteeringChannel } from "./steering.js";

function textOf(content: unknown): string {
  return typeof content === "string" ? content : "";
}

describe("SteeringChannel", () => {
  it("yields buffered messages in order", async () => {
    const channel = new SteeringChannel();
    channel.push("task");
    channel.push("correction");
    expect(channel.pending()).toBe(2);

    const out: string[] = [];
    for await (const msg of channel) {
      out.push(textOf(msg.message.content));
      if (out.length === 2) break;
    }
    expect(out).toEqual(["task", "correction"]);
  });

  it("delivers a message pushed while the consumer is waiting", async () => {
    const channel = new SteeringChannel();
    const consumed: string[] = [];
    const consumer = (async () => {
      for await (const msg of channel) consumed.push(textOf(msg.message.content));
    })();

    channel.push("first");
    await new Promise((r) => setTimeout(r, 5));
    channel.push("second");
    await new Promise((r) => setTimeout(r, 5));
    channel.close();
    await consumer;

    expect(consumed).toEqual(["first", "second"]);
  });

  it("ends iteration on close and rejects later pushes", async () => {
    const channel = new SteeringChannel();
    channel.close();

    const out: string[] = [];
    for await (const msg of channel) out.push(textOf(msg.message.content));
    expect(out).toEqual([]);
    expect(() => channel.push("late")).toThrow(/finished/);
  });
});
