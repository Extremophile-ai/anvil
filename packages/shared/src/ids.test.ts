import { describe, expect, it } from "vitest";
import { newJobId, newMemoryId, newTaskId } from "./ids.js";

describe("id generators", () => {
  it("produce prefixed, unique ids", () => {
    expect(newJobId()).toMatch(/^job_[0-9a-f-]{36}$/);
    expect(newTaskId()).toMatch(/^task_[0-9a-f-]{36}$/);
    expect(newMemoryId()).toMatch(/^mem_[0-9a-f-]{36}$/);
    expect(newJobId()).not.toBe(newJobId());
  });
});
