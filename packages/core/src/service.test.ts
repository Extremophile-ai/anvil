import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Orchestrator } from "./orchestrator/orchestrator.js";
import { HeuristicPlanner, LlmPlanner, type Planner } from "./orchestrator/planner.js";
import { AnvilService } from "./service.js";

/** Reach through the public AnvilService API into the orchestrator's private
 *  planner field — fine for tests, where we want to assert the wiring without
 *  shipping a getter just for instrumentation. */
function plannerOf(service: AnvilService): Planner {
  const orchestrator = (service as unknown as { orchestrator: Orchestrator }).orchestrator;
  return (orchestrator as unknown as { planner: Planner }).planner;
}

describe("AnvilService.create planner wiring", () => {
  let workspaceRoot: string;
  let service: AnvilService | undefined;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "anvil-service-test-"));
  });

  afterEach(() => {
    service?.close();
    service = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("defaults to a HeuristicPlanner when ANVIL_PLANNER is unset", async () => {
    vi.stubEnv("ANVIL_PLANNER", "");
    service = await AnvilService.create(workspaceRoot);
    expect(plannerOf(service)).toBeInstanceOf(HeuristicPlanner);
  });

  it("opts in to an LlmPlanner when ANVIL_PLANNER=llm", async () => {
    vi.stubEnv("ANVIL_PLANNER", "llm");
    service = await AnvilService.create(workspaceRoot);
    expect(plannerOf(service)).toBeInstanceOf(LlmPlanner);
  });

  it("warns on stderr and falls back to HeuristicPlanner for unrecognized values", async () => {
    vi.stubEnv("ANVIL_PLANNER", "bogus");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    service = await AnvilService.create(workspaceRoot);
    expect(plannerOf(service)).toBeInstanceOf(HeuristicPlanner);
    expect(stderrSpy).toHaveBeenCalled();
    const message = stderrSpy.mock.calls.map((call) => String(call[0] ?? "")).join("");
    expect(message).toContain("ANVIL_PLANNER");
    expect(message).toContain("bogus");
    expect(message).toContain("HeuristicPlanner");
  });
});
