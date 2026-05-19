/**
 * Git-backed checkpoints. Before a risky step the harness snapshots the whole
 * working tree; if the step fails, it rolls the tree back. Snapshots are kept
 * as commit objects under `refs/anvil/checkpoints/*`, so they survive process
 * restarts and never appear in normal history or `git log`.
 */
import { type CheckpointId, newCheckpointId } from "@anvil/shared";
import { AnvilError } from "../lib/errors.js";
import { runCommand } from "../lib/exec.js";

const REF_PREFIX = "refs/anvil/checkpoints";

export interface Checkpoint {
  id: CheckpointId;
  ref: string;
  sha: string;
  label: string;
  createdAt: string;
}

export class GitCheckpoints {
  constructor(private readonly cwd: string) {}

  private async git(...args: string[]): Promise<string> {
    const result = await runCommand("git", args, { cwd: this.cwd });
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new AnvilError("GIT_ERROR", `git ${args[0] ?? ""} failed: ${detail}`);
    }
    return result.stdout.trim();
  }

  /** True when `cwd` is inside a git working tree. */
  async isRepo(): Promise<boolean> {
    const result = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: this.cwd });
    return result.code === 0 && result.stdout.trim() === "true";
  }

  /** Snapshot the working tree (tracked + untracked; ignored files excluded). */
  async checkpoint(label: string): Promise<Checkpoint> {
    const id = newCheckpointId();
    const ref = `${REF_PREFIX}/${id}`;
    await this.git("add", "-A");
    const tree = await this.git("write-tree");
    let sha: string;
    const head = await runCommand("git", ["rev-parse", "HEAD"], { cwd: this.cwd });
    if (head.code === 0) {
      sha = await this.git("commit-tree", tree, "-p", head.stdout.trim(), "-m", `anvil checkpoint: ${label}`);
    } else {
      // A repository with no commits yet — make a parentless snapshot.
      sha = await this.git("commit-tree", tree, "-m", `anvil checkpoint: ${label}`);
    }
    await this.git("update-ref", ref, sha);
    await this.git("reset", "-q"); // unstage; the working tree is left untouched
    return { id, ref, sha, label, createdAt: new Date().toISOString() };
  }

  /** Restore the working tree to a checkpoint, discarding everything since. */
  async restore(id: CheckpointId): Promise<void> {
    const sha = await this.git("rev-parse", "--verify", `${REF_PREFIX}/${id}`);
    await runCommand("git", ["clean", "-fdq"], { cwd: this.cwd });
    await this.git("checkout", "-q", sha, "--", ".");
    await this.git("reset", "-q");
  }

  async list(): Promise<Array<{ id: CheckpointId; sha: string }>> {
    const out = await this.git("for-each-ref", "--format=%(refname) %(objectname)", REF_PREFIX);
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [refname = "", sha = ""] = line.split(" ");
      return { id: refname.slice(REF_PREFIX.length + 1) as CheckpointId, sha };
    });
  }

  /** Drop every checkpoint ref. */
  async clear(): Promise<void> {
    for (const { id } of await this.list()) {
      await runCommand("git", ["update-ref", "-d", `${REF_PREFIX}/${id}`], { cwd: this.cwd });
    }
  }
}
