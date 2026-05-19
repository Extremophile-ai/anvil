/**
 * Anvil live runtime smoke — a real run against the LLM provider.
 *
 * Run with: `pnpm smoke:live` (builds first).
 *
 * Authentication: the Claude Agent SDK uses whatever Claude Code on this
 * machine is logged in with.
 *   - A Claude.ai Pro/Max subscription — just be logged into Claude Code.
 *     Nothing else to set up; usage is covered by the subscription.
 *   - Or ANTHROPIC_API_KEY — metered pay-per-token billing instead.
 *
 * This is intentionally NOT part of `pnpm test` or `pnpm smoke`: it makes a
 * real model call, so it is opt-in.
 */
import { EventBus, Runtime } from "../packages/core/dist/index.js";
import { newJobId } from "../packages/shared/dist/index.js";

const bus = new EventBus();
bus.on((event) => {
  if (event.kind === "assistant.text") {
    console.log(`  [assistant] ${event.message.trim().slice(0, 240)}`);
  }
  if (event.kind === "run.failed") console.log(`  [error] ${event.message}`);
});

const runtime = new Runtime({
  bus,
  config: { cwd: process.cwd(), model: "opus", permissionMode: "bypassPermissions", maxTurns: 3 },
});

console.log("Anvil — live runtime smoke. Connecting to the LLM provider...\n");
const startedAt = Date.now();

const result = await runtime.run(
  newJobId(),
  "Reply with exactly this token and nothing else: ANVIL-LIVE-OK. Do not call any tools.",
);

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `\nok: ${result.ok} | turns: ${result.numTurns} | ${seconds}s | cost: $${result.costUsd.toFixed(4)}`,
);

if (!result.ok) {
  console.log(`LIVE TEST FAILED: ${result.error ?? "unknown error"}`);
  console.log(
    "If this is an auth error, make sure Claude Code on this machine is logged in " +
      "(your Claude.ai subscription), or set ANTHROPIC_API_KEY.",
  );
  process.exit(1);
}

const connected = result.result.includes("ANVIL-LIVE-OK");
console.log(
  connected
    ? "LIVE TEST OK — the runtime reached the model and completed a full run."
    : `LIVE TEST: connected, but unexpected output: ${result.result.slice(0, 160)}`,
);
process.exit(connected ? 0 : 1);
