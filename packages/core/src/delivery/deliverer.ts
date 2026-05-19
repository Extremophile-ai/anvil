/**
 * Delivery — how the harness ships its work: a feature branch, conventional
 * commits as it goes, and a pull request when it is done. The deliverer
 * refuses to touch the default branch directly; the only path to `main` is
 * through a PR.
 */
import { AnvilError } from "../lib/errors.js";
import { runCommand } from "../lib/exec.js";
import type { Workspace } from "../lib/workspace.js";
import type { CommandRunner } from "../sandbox/types.js";

export interface DelivererConfig {
  workspace: Workspace;
  /** Git remote. Defaults to "origin". */
  remote?: string;
  /** Author identity for harness commits. Defaults to the repo's git config. */
  author?: { name: string; email: string };
  /** Pluggable command runner for tests. Defaults to runCommand. */
  runner?: CommandRunner;
}

export class Deliverer {
  private readonly workspace: Workspace;
  private readonly remote: string;
  private readonly author: { name: string; email: string } | undefined;
  private readonly runner: CommandRunner;

  constructor(config: DelivererConfig) {
    this.workspace = config.workspace;
    this.remote = config.remote ?? "origin";
    this.author = config.author;
    this.runner = config.runner ?? runCommand;
  }

  private async git(args: string[]): Promise<string> {
    const result = await this.runner("git", args, { cwd: this.workspace.root });
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new AnvilError("GIT_ERROR", `git ${args[0] ?? ""} failed: ${detail}`);
    }
    return result.stdout.trim();
  }

  async isRepo(): Promise<boolean> {
    const result = await this.runner("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: this.workspace.root,
    });
    return result.code === 0 && result.stdout.trim() === "true";
  }

  async currentBranch(): Promise<string> {
    return this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  async isClean(): Promise<boolean> {
    return (await this.git(["status", "--porcelain"])) === "";
  }

  /** Detect the repo's default branch — `origin/HEAD` first, then main/master. */
  async defaultBranch(): Promise<string> {
    const remoteHead = await this.runner(
      "git",
      ["symbolic-ref", "--short", `refs/remotes/${this.remote}/HEAD`],
      { cwd: this.workspace.root },
    );
    if (remoteHead.code === 0) {
      return remoteHead.stdout.trim().split("/").slice(1).join("/");
    }
    const branches = (await this.git(["branch", "--list"])).split("\n").map((line) => line.replace(/^[*\s]+/, ""));
    if (branches.includes("main")) return "main";
    if (branches.includes("master")) return "master";
    return "main";
  }

  /** Create and check out a feature branch. Refuses to overwrite the default. */
  async startBranch(branchName: string, options: { fromBranch?: string } = {}): Promise<void> {
    const defaultBranch = await this.defaultBranch();
    if (branchName === defaultBranch) {
      throw new AnvilError(
        "GIT_ERROR",
        `Refusing to use the default branch "${defaultBranch}" as a feature branch.`,
      );
    }
    if (options.fromBranch !== undefined) await this.git(["checkout", options.fromBranch]);
    await this.git(["checkout", "-b", branchName]);
  }

  /** Stage everything and commit. Returns the commit SHA. */
  async commit(message: string, options: { allowEmpty?: boolean } = {}): Promise<string> {
    await this.git(["add", "-A"]);
    const args = ["commit", "-m", message];
    if (options.allowEmpty) args.push("--allow-empty");
    if (this.author) args.push("--author", `${this.author.name} <${this.author.email}>`);
    await this.git(args);
    return this.git(["rev-parse", "HEAD"]);
  }

  /** Push the current branch. Refuses to push to the default branch. */
  async push(options: { setUpstream?: boolean } = {}): Promise<void> {
    const branch = await this.currentBranch();
    const defaultBranch = await this.defaultBranch();
    if (branch === defaultBranch) {
      throw new AnvilError(
        "GIT_ERROR",
        `Refusing to push directly to the default branch "${defaultBranch}". Open a PR instead.`,
      );
    }
    const args = ["push"];
    if (options.setUpstream !== false) args.push("-u");
    args.push(this.remote, branch);
    await this.git(args);
  }

  /** Open a pull request with `gh`. Returns the PR URL. */
  async openPullRequest(options: {
    title: string;
    body: string;
    base?: string;
    draft?: boolean;
  }): Promise<string> {
    const args = ["pr", "create", "--title", options.title, "--body", options.body];
    if (options.base !== undefined) args.push("--base", options.base);
    if (options.draft) args.push("--draft");
    const result = await this.runner("gh", args, { cwd: this.workspace.root });
    if (result.code !== 0) {
      throw new AnvilError(
        "GIT_ERROR",
        `gh pr create failed: ${result.stderr.trim() || result.stdout.trim()}. ` +
          "Make sure gh is installed and you are authenticated (`gh auth login`).",
      );
    }
    return result.stdout.trim();
  }
}
