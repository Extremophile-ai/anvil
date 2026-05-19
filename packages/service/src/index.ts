#!/usr/bin/env node
/**
 * anvil-service — Anvil exposed as an HTTP daemon with SSE event streams.
 *
 * Binds to 127.0.0.1 by default; override with ANVIL_SERVICE_HOST and
 * ANVIL_SERVICE_PORT (default 4477). Run from a workspace root; state lives
 * under `.anvil/` in that workspace.
 */
import { AnvilService } from "@anvil/core";
import { AnvilHttpServer } from "./server.js";

async function main(): Promise<void> {
  const host = process.env.ANVIL_SERVICE_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.ANVIL_SERVICE_PORT ?? "4477", 10);

  const service = await AnvilService.create(process.cwd());
  const server = new AnvilHttpServer({
    service,
    host,
    port: Number.isFinite(port) ? port : 4477,
    version: "0.0.0",
  });

  const address = await server.listen();
  process.stdout.write(`anvil-service listening on http://${address.host}:${address.port}\n`);

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`anvil-service shutting down (${signal})...\n`);
    await server.close();
    service.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`anvil-service fatal: ${message}\n`);
  process.exit(1);
});
