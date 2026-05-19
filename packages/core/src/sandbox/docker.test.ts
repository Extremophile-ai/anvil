import { describe, expect, it } from "vitest";
import type { CommandResult } from "../lib/exec.js";
import { Workspace } from "../lib/workspace.js";
import { DockerSandbox } from "./docker.js";

interface RecordedCall {
  command: string;
  args: string[];
}

function fakeRunner(responses: CommandResult[]) {
  const calls: RecordedCall[] = [];
  const runner = (command: string, args: string[]): Promise<CommandResult> => {
    calls.push({ command, args });
    return Promise.resolve(responses.shift() ?? { code: 0, stdout: "", stderr: "" });
  };
  return { runner, calls };
}

describe("DockerSandbox", () => {
  it("starts a container with the workspace mounted at /workspace", async () => {
    const { runner, calls } = fakeRunner([{ code: 0, stdout: "abc123\n", stderr: "" }]);
    const sandbox = new DockerSandbox({
      workspace: new Workspace("/tmp/anvil-docker"),
      image: "node:22",
      runner,
    });
    await sandbox.start();
    expect(calls[0]?.command).toBe("docker");
    expect(calls[0]?.args).toContain("run");
    expect(calls[0]?.args).toContain("-v");
    expect(calls[0]?.args.some((arg) => arg.endsWith(":/workspace"))).toBe(true);
    expect(calls[0]?.args).toContain("node:22");
  });

  it("execs commands inside the container with --workdir", async () => {
    const { runner, calls } = fakeRunner([
      { code: 0, stdout: "", stderr: "" }, // start
      { code: 0, stdout: "ok", stderr: "" }, // exec
    ]);
    const sandbox = new DockerSandbox({ workspace: new Workspace("/tmp/anvil-docker"), runner });
    await sandbox.start();
    const result = await sandbox.exec("ls", ["-la"], { cwd: "src" });
    expect(result.stdout).toBe("ok");
    const execCall = calls[1]?.args;
    expect(execCall?.[0]).toBe("exec");
    expect(execCall?.includes("--workdir")).toBe(true);
    expect(execCall?.some((arg) => arg.includes("/workspace/src"))).toBe(true);
    expect(execCall).toContain("ls");
    expect(execCall).toContain("-la");
  });

  it("refuses to exec before start", async () => {
    const { runner } = fakeRunner([]);
    const sandbox = new DockerSandbox({ workspace: new Workspace("/tmp/anvil-docker"), runner });
    await expect(sandbox.exec("ls", [])).rejects.toThrow(/start\(\)/);
  });

  it("stops and removes the container", async () => {
    const { runner, calls } = fakeRunner([
      { code: 0, stdout: "", stderr: "" }, // start
      { code: 0, stdout: "", stderr: "" }, // stop
      { code: 0, stdout: "", stderr: "" }, // rm
    ]);
    const sandbox = new DockerSandbox({ workspace: new Workspace("/tmp/anvil-docker"), runner });
    await sandbox.start();
    await sandbox.stop();
    const tail = calls.slice(-2).map((call) => call.args[0]);
    expect(tail).toContain("stop");
    expect(tail).toContain("rm");
  });
});
