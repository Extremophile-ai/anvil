/**
 * DockerSandbox — runs commands inside a long-lived container with the
 * workspace mounted at `/workspace`. The container is created lazily on
 * `start()` and removed on `stop()`.
 */
import { randomUUID } from "node:crypto";
import { AnvilError } from "../lib/errors.js";
import { runCommand } from "../lib/exec.js";
import type { Workspace } from "../lib/workspace.js";
import { type CommandRunner, type Sandbox, type SandboxExecOptions, type SandboxResult } from "./types.js";

const DEFAULT_IMAGE = "node:22-bookworm-slim";
const CONTAINER_WORKDIR = "/workspace";

export interface DockerSandboxDeps {
  workspace: Workspace;
  /** Container image. Defaults to a slim Node 22 image matching the harness's engine. */
  image?: string;
  /** Override the generated container name. */
  containerName?: string;
  /** Extra `docker run` arguments (e.g. `--network none`). */
  extraRunArgs?: string[];
  /** Pluggable for tests. Defaults to `runCommand`. */
  runner?: CommandRunner;
}

export class DockerSandbox implements Sandbox {
  readonly id: string;
  readonly kind = "docker" as const;
  readonly image: string;
  readonly containerName: string;

  private readonly workspace: Workspace;
  private readonly runner: CommandRunner;
  private readonly extraRunArgs: string[];
  private started = false;

  constructor(deps: DockerSandboxDeps) {
    this.workspace = deps.workspace;
    this.image = deps.image ?? DEFAULT_IMAGE;
    this.containerName = deps.containerName ?? `anvil-${randomUUID().slice(0, 8)}`;
    this.runner = deps.runner ?? runCommand;
    this.extraRunArgs = deps.extraRunArgs ?? [];
    this.id = `docker:${this.containerName}`;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const result = await this.runner("docker", [
      "run",
      "-d",
      "--name",
      this.containerName,
      "-v",
      `${this.workspace.root}:${CONTAINER_WORKDIR}`,
      "--workdir",
      CONTAINER_WORKDIR,
      ...this.extraRunArgs,
      this.image,
      "tail",
      "-f",
      "/dev/null",
    ]);
    if (result.code !== 0) {
      throw new AnvilError(
        "SANDBOX_ERROR",
        `Failed to start the Docker sandbox: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    this.started = true;
  }

  async exec(
    command: string,
    args: string[],
    options: SandboxExecOptions = {},
  ): Promise<SandboxResult> {
    if (!this.started) {
      throw new AnvilError("SANDBOX_ERROR", "Call start() on the Docker sandbox before exec().");
    }
    const dockerArgs: string[] = ["exec"];
    const containerCwd = options.cwd
      ? `${CONTAINER_WORKDIR}/${options.cwd.replace(/^\.\/?/, "").replace(/^\//, "")}`
      : CONTAINER_WORKDIR;
    dockerArgs.push("--workdir", containerCwd);
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        dockerArgs.push("-e", `${key}=${value}`);
      }
    }
    dockerArgs.push(this.containerName, command, ...args);
    const runOptions: { timeoutMs?: number } = {};
    if (options.timeoutMs !== undefined) runOptions.timeoutMs = options.timeoutMs;
    return this.runner("docker", dockerArgs, runOptions);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.runner("docker", ["stop", this.containerName]);
    await this.runner("docker", ["rm", this.containerName]);
    this.started = false;
  }
}
