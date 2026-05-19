/**
 * Running external commands. `execFile` is used (never a shell), so arguments
 * are passed verbatim and are not subject to shell injection.
 */
import { execFile } from "node:child_process";
import { AnvilError } from "./errors.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Max bytes captured per stream. Default 32 MiB. */
  maxBuffer?: number;
}

/**
 * Run a command. Resolves with the exit code even when it is non-zero — only a
 * spawn failure or a timeout rejects, so callers decide what a non-zero code
 * means.
 */
export function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs ?? 0,
        maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
          if (err.killed) {
            reject(
              new AnvilError("RUNTIME_ERROR", `Command timed out: ${command} ${args.join(" ")}`, {
                retryable: true,
                cause: error,
              }),
            );
            return;
          }
          if (typeof err.code === "number") {
            resolve({ code: err.code, stdout, stderr });
            return;
          }
          reject(
            new AnvilError("RUNTIME_ERROR", `Failed to run "${command}": ${error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        resolve({ code: 0, stdout, stderr });
      },
    );
  });
}
