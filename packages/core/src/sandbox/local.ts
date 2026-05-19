/**
 * LocalSandbox — runs commands in the workspace on the host. No isolation;
 * useful when Anvil is already running in a trusted context, or when the
 * overhead of Docker is not worth it.
 */
import { type CommandRunner, type Sandbox, type SandboxExecOptions, type SandboxResult } from "./types.js";
import { runCommand } from "../lib/exec.js";
import type { Workspace } from "../lib/workspace.js";

export interface LocalSandboxDeps {
  workspace: Workspace;
  /** Pluggable for tests. Defaults to `runCommand`. */
  runner?: CommandRunner;
}

export class LocalSandbox implements Sandbox {
  readonly id = "local";
  readonly kind = "local" as const;
  private readonly workspace: Workspace;
  private readonly runner: CommandRunner;

  constructor(deps: LocalSandboxDeps) {
    this.workspace = deps.workspace;
    this.runner = deps.runner ?? runCommand;
  }

  async exec(
    command: string,
    args: string[],
    options: SandboxExecOptions = {},
  ): Promise<SandboxResult> {
    const cwd = this.workspace.resolve(options.cwd ?? ".");
    const runOptions: { cwd: string; env?: Record<string, string>; timeoutMs?: number } = { cwd };
    if (options.env !== undefined) runOptions.env = options.env;
    if (options.timeoutMs !== undefined) runOptions.timeoutMs = options.timeoutMs;
    return this.runner(command, args, runOptions);
  }
}
