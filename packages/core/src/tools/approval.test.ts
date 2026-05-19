import { newJobId } from "@anvil/shared";
import { describe, expect, it } from "vitest";
import { ApprovalRegistry } from "./approval.js";

const preview = { summary: "do a thing" };

describe("ApprovalRegistry", () => {
  it("issues a token that redeems exactly once", () => {
    const registry = new ApprovalRegistry();
    const approval = registry.issue("write_file", { path: "x" }, preview, newJobId());

    const redeemed = registry.redeem(approval.token);
    expect(redeemed.tool).toBe("write_file");
    expect(() => registry.redeem(approval.token)).toThrow(/No pending approval/);
  });

  it("rejects an unknown token", () => {
    expect(() => new ApprovalRegistry().redeem("apt_does-not-exist")).toThrow(/No pending approval/);
  });

  it("rejects an expired token", () => {
    const registry = new ApprovalRegistry(-1);
    const approval = registry.issue("delete_file", { path: "y" }, preview, newJobId());
    expect(() => registry.redeem(approval.token)).toThrow(/expired/);
  });
});
