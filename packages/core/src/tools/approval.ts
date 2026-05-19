/**
 * The two-phase approval ledger. A write tool physically cannot execute without
 * a valid, unexpired, single-use token issued here — approval is a code check,
 * not a prompt instruction.
 */
import { type ApprovalToken, type JobId, newApprovalToken } from "@anvil/shared";
import { AnvilError } from "../lib/errors.js";
import type { ToolPreview } from "./types.js";

export interface PendingApproval {
  token: ApprovalToken;
  tool: string;
  input: unknown;
  preview: ToolPreview;
  jobId: JobId;
  createdAt: number;
  expiresAt: number;
}

export class ApprovalRegistry {
  private readonly pendingByToken = new Map<string, PendingApproval>();

  /** @param ttlMs how long an issued token stays valid. Default 5 minutes. */
  constructor(private readonly ttlMs: number = 5 * 60_000) {}

  /** Record a previewed write and issue a token for it. */
  issue(tool: string, input: unknown, preview: ToolPreview, jobId: JobId): PendingApproval {
    const now = Date.now();
    const approval: PendingApproval = {
      token: newApprovalToken(),
      tool,
      input,
      preview,
      jobId,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.pendingByToken.set(approval.token, approval);
    return approval;
  }

  /** Consume a token. Single-use; throws if unknown or expired. */
  redeem(token: string): PendingApproval {
    const approval = this.pendingByToken.get(token);
    if (!approval) {
      throw new AnvilError(
        "APPROVAL_INVALID_TOKEN",
        "No pending approval matches this token. Call the tool again to get a fresh preview and token.",
      );
    }
    this.pendingByToken.delete(token);
    if (Date.now() > approval.expiresAt) {
      throw new AnvilError(
        "APPROVAL_EXPIRED",
        `The approval for "${approval.tool}" expired. Call the tool again to get a fresh preview and token.`,
      );
    }
    return approval;
  }

  get(token: string): PendingApproval | undefined {
    return this.pendingByToken.get(token);
  }

  pending(): PendingApproval[] {
    this.prune();
    return [...this.pendingByToken.values()];
  }

  /** Drop expired tokens. */
  prune(): void {
    const now = Date.now();
    for (const [token, approval] of this.pendingByToken) {
      if (now > approval.expiresAt) this.pendingByToken.delete(token);
    }
  }
}
