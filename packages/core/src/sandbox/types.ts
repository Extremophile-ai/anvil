/**
 * The sandbox — where the agent's build and test commands run. Two
 * implementations satisfy this interface:
 *   - LocalSandbox: in the workspace, on the host. Fast, no isolation.
 *   - DockerSandbox: in a container with the workspace mounted. Isolated.
 */
import type { CommandResult, RunOptions } from "../lib/exec.js";

export type SandboxKind = "local" | "docker";

export interface SandboxExecOptions {
  /** Working directory, relative to the workspace root. Defaults to root. */
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type SandboxResult = CommandResult;

export interface Sandbox {
  readonly id: string;
  readonly kind: SandboxKind;
  /** Run a command (no shell — args are passed verbatim). */
  exec(command: string, args: string[], options?: SandboxExecOptions): Promise<SandboxResult>;
  /** Optional lifecycle for sandboxes that need setup. */
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

/** A pluggable command runner — `runCommand` by default, a fake in tests. */
export type CommandRunner = (
  command: string,
  args: string[],
  options?: RunOptions,
) => Promise<CommandResult>;
