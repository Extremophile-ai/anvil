import { newJobId } from "@anvil/shared";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/bus.js";
import { AnvilError } from "../lib/errors.js";
import { EscalationError } from "./escalation.js";
import { SelfHealer } from "./healer.js";
import { StrikeBoard } from "./recovery.js";

const fast = { baseDelayMs: 1, jitter: false };

describe("SelfHealer", () => {
  it("runs work and returns its value", async () => {
    const healer = new SelfHealer({ bus: new EventBus() });
    const result = await healer.run({ jobId: newJobId(), label: "step" }, () => Promise.resolve("done"));
    expect(result).toBe("done");
  });

  it("retries transient failures within a run", async () => {
    const healer = new SelfHealer({ bus: new EventBus() });
    let calls = 0;
    const result = await healer.run(
      { jobId: newJobId(), label: "flaky", retry: { ...fast, maxAttempts: 5 } },
      () => {
        calls += 1;
        if (calls < 3) {
          return Promise.reject(new AnvilError("RATE_LIMITED", "overloaded", { retryable: true }));
        }
        return Promise.resolve("recovered");
      },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("escalates once the strike limit is reached", async () => {
    const escalate = vi.fn();
    const healer = new SelfHealer({ bus: new EventBus(), strikes: new StrikeBoard(2), escalate });
    const jobId = newJobId();
    const attempt = (): Promise<string> =>
      healer.run({ jobId, label: "doomed", strikeKey: "doomed", retry: fast }, () =>
        Promise.reject(new AnvilError("INVALID_INPUT", "always wrong")),
      );

    await expect(attempt()).rejects.toThrow(/always wrong/); // strike 1
    await expect(attempt()).rejects.toThrow(EscalationError); // strike 2 → escalate
    expect(escalate).toHaveBeenCalledOnce();
  });
});
