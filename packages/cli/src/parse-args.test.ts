import { describe, expect, it } from "vitest";
import { flagBool, flagInt, flagString, parseArgs } from "./parse-args.js";

describe("parseArgs", () => {
  it("defaults to the help command when given nothing", () => {
    expect(parseArgs([]).command).toBe("help");
  });

  it("splits positional args and flags", () => {
    const parsed = parseArgs(["build", "do", "the", "thing", "--model", "opus", "--skip-delivery"]);
    expect(parsed.command).toBe("build");
    expect(parsed.positional).toEqual(["do", "the", "thing"]);
    expect(parsed.flags).toEqual({ model: "opus", "skip-delivery": true });
  });

  it("reads flag helpers", () => {
    const parsed = parseArgs(["ingest", "--top-k", "12", "--verbose"]);
    expect(flagString(parsed, "top-k")).toBe("12");
    expect(flagInt(parsed, "top-k")).toBe(12);
    expect(flagBool(parsed, "verbose")).toBe(true);
    expect(flagInt(parsed, "missing")).toBeUndefined();
  });
});
