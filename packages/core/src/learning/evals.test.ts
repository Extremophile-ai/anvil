import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateStore } from "../state/store.js";
import { EvalSuite } from "./evals.js";

describe("EvalSuite", () => {
  let store: StateStore;
  let suite: EvalSuite;

  beforeEach(() => {
    store = StateStore.memory();
    suite = new EvalSuite(store);
  });

  afterEach(() => store.close());

  it("adds and lists evals", () => {
    suite.add({ name: "first", scenario: "s", expectation: "x" });
    suite.add({ name: "second", scenario: "s", expectation: "x" });
    expect(suite.list().length).toBe(2);
    expect(suite.list("pending").length).toBe(2);
  });

  it("runs evals through a checker and records the outcomes", async () => {
    const passing = suite.add({ name: "passes", scenario: "s", expectation: "x" });
    suite.add({ name: "fails", scenario: "s", expectation: "x" });

    const report = await suite.run((evalCase) => evalCase.name === "passes");

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(suite.get(passing.id)?.status).toBe("passing");
    expect(suite.list("failing").length).toBe(1);
  });
});
