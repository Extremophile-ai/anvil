import { describe, expect, it } from "vitest";
import { AnvilError } from "../lib/errors.js";
import { classifyError, StrikeBoard } from "./recovery.js";

describe("classifyError", () => {
  it("routes transient errors to retry", () => {
    expect(classifyError(new Error("server overloaded")).action).toBe("retry");
  });

  it("routes unknown errors to fail", () => {
    expect(classifyError(new AnvilError("INVALID_INPUT", "nope")).action).toBe("fail");
  });

  it("routes exhausted retries to escalate", () => {
    expect(classifyError(new AnvilError("MAX_RETRIES_EXCEEDED", "done")).action).toBe("escalate");
  });

  it("routes context overflow to restore", () => {
    expect(classifyError(new AnvilError("CONTEXT_OVERFLOW", "too big")).action).toBe("restore");
  });
});

describe("StrikeBoard", () => {
  it("counts strikes and reports when the limit is exceeded", () => {
    const board = new StrikeBoard(3);
    expect(board.record("step")).toBe(1);
    expect(board.record("step")).toBe(2);
    expect(board.exceeded("step")).toBe(false);
    expect(board.record("step")).toBe(3);
    expect(board.exceeded("step")).toBe(true);
    board.clear("step");
    expect(board.count("step")).toBe(0);
  });
});
