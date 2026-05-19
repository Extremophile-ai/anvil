/**
 * AnvilHttpServer — REST + SSE over node:http, no framework dep.
 *
 *   POST  /builds                 start a build (or goal build)        202 → { jobId }
 *   GET   /builds                 list every persisted job
 *   GET   /builds/:id             one job's status + plan
 *   GET   /builds/:id/events      SSE stream of AnvilEvents for the job
 *   POST  /builds/:id/steer       body { text }
 *   POST  /builds/:id/interrupt   stop the running build
 *   POST  /ingest                 body { dir? }
 *   POST  /memory/recall          body { query, topK? }
 *   GET   /memory?scope=          list facts (optional scope)
 *   GET   /healthz                liveness + version + active job
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AnvilService, StartBuildOptions } from "@anvil/core";
import { z } from "zod";

const buildBodySchema = z.strictObject({
  task: z.string().min(1),
  goal: z
    .strictObject({
      condition: z.string().min(1),
      verify: z.array(z.string()).optional(),
      maxIterations: z.number().int().positive().optional(),
    })
    .optional(),
  skipDelivery: z.boolean().optional(),
  skipReflection: z.boolean().optional(),
  maxTurns: z.number().int().positive().optional(),
  model: z.string().optional(),
});

const steerBodySchema = z.strictObject({ text: z.string().min(1) });
const ingestBodySchema = z.strictObject({ dir: z.string().optional() });
const recallBodySchema = z.strictObject({
  query: z.string().min(1),
  topK: z.number().int().positive().optional(),
});

export interface AnvilHttpServerOptions {
  service: AnvilService;
  host?: string;
  port?: number;
  version?: string;
}

export class AnvilHttpServer {
  private readonly server: Server;
  private readonly service: AnvilService;
  private readonly host: string;
  private readonly desiredPort: number;
  private readonly version: string;

  constructor(options: AnvilHttpServerOptions) {
    this.service = options.service;
    this.host = options.host ?? "127.0.0.1";
    this.desiredPort = options.port ?? 4477;
    this.version = options.version ?? "0.0.0";
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => this.fail(res, err));
    });
  }

  /** Start listening. Returns the actual host + port (port 0 binds randomly). */
  async listen(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve) => {
      this.server.listen(this.desiredPort, this.host, resolve);
    });
    const address = this.server.address();
    const port = typeof address === "object" && address !== null ? address.port : this.desiredPort;
    return { host: this.host, port };
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === "/healthz") {
      this.json(res, 200, { ok: true, version: this.version, activeJob: this.service.currentJob() ?? null });
      return;
    }

    if (method === "POST" && path === "/builds") {
      const parsed = buildBodySchema.safeParse(await this.readJson(req));
      if (!parsed.success) return this.json(res, 400, { error: parsed.error.message });
      const body = parsed.data;
      const options: StartBuildOptions = {};
      if (body.goal) options.goal = body.goal;
      if (body.skipDelivery !== undefined) options.skipDelivery = body.skipDelivery;
      if (body.skipReflection !== undefined) options.skipReflection = body.skipReflection;
      if (body.maxTurns !== undefined) options.maxTurns = body.maxTurns;
      if (body.model !== undefined) options.model = body.model;
      const result = await this.service.startBuild(body.task, options);
      return this.json(res, 202, result);
    }

    if (method === "GET" && path === "/builds") {
      return this.json(res, 200, this.service.listJobs());
    }

    const buildMatch = /^\/builds\/([^/]+)(\/(steer|interrupt|events))?$/.exec(path);
    if (buildMatch) {
      const id = buildMatch[1] ?? "";
      const sub = buildMatch[3] ?? "";
      if (method === "GET" && sub === "") {
        const job = this.service.getStatus(id);
        if (!job) return this.json(res, 404, { error: `No job with id "${id}".` });
        return this.json(res, 200, job);
      }
      if (method === "GET" && sub === "events") {
        return this.streamEvents(req, res, id);
      }
      if (method === "POST" && sub === "steer") {
        const parsed = steerBodySchema.safeParse(await this.readJson(req));
        if (!parsed.success) return this.json(res, 400, { error: parsed.error.message });
        return this.json(res, 200, this.service.steer(id, parsed.data.text));
      }
      if (method === "POST" && sub === "interrupt") {
        return this.json(res, 200, await this.service.interrupt(id));
      }
    }

    if (method === "POST" && path === "/ingest") {
      const parsed = ingestBodySchema.safeParse(await this.readJson(req));
      if (!parsed.success) return this.json(res, 400, { error: parsed.error.message });
      return this.json(res, 200, await this.service.ingest(parsed.data.dir));
    }

    if (method === "POST" && path === "/memory/recall") {
      const parsed = recallBodySchema.safeParse(await this.readJson(req));
      if (!parsed.success) return this.json(res, 400, { error: parsed.error.message });
      return this.json(res, 200, await this.service.recall(parsed.data.query, parsed.data.topK));
    }

    if (method === "GET" && path === "/memory") {
      const scope = url.searchParams.get("scope");
      const filtered = scope === "project" || scope === "global" ? scope : undefined;
      return this.json(res, 200, this.service.listMemory(filtered));
    }

    return this.json(res, 404, { error: `Not found: ${method} ${path}` });
  }

  private streamEvents(req: IncomingMessage, res: ServerResponse, jobId: string): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 5000\n\n");
    const off = this.service.bus.on((event) => {
      if (event.jobId === jobId) res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    const cleanup = (): void => {
      off();
      clearInterval(heartbeat);
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    }
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return {};
    }
  }

  private json(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }

  private fail(res: ServerResponse, err: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.json(res, 500, { error: message });
  }
}
