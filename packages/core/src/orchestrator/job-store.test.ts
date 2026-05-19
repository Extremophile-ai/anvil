import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateStore } from "../state/store.js";
import { JobStore } from "./job-store.js";
import { createPlan } from "./plan.js";

describe("JobStore", () => {
  let store: StateStore;
  let jobs: JobStore;

  beforeEach(() => {
    store = StateStore.memory();
    jobs = new JobStore(store);
  });

  afterEach(() => store.close());

  it("creates and reads a job", () => {
    const job = jobs.create("build a login page");
    expect(job.status).toBe("queued");
    expect(jobs.get(job.id)?.task).toBe("build a login page");
  });

  it("updates status, result, and plan, and persists them", () => {
    const job = jobs.create("build an API");
    const plan = createPlan("build an API", [
      { id: "t1", title: "endpoint", description: "", kind: "task", dependencies: [], status: "pending" },
    ]);
    jobs.update(job.id, { status: "running", plan });
    const updated = jobs.update(job.id, { status: "succeeded", result: "done" });

    expect(updated.status).toBe("succeeded");
    expect(updated.result).toBe("done");
    expect(jobs.get(job.id)?.plan?.nodes.length).toBe(1);
  });

  it("lists jobs and rejects updating a missing one", () => {
    jobs.create("one");
    jobs.create("two");
    expect(jobs.list().length).toBe(2);
    expect(() => jobs.update("job_missing", { status: "failed" })).toThrow(/No job/);
  });
});
