/**
 * The workspace ingestor — the entry point for "plug Anvil into any project".
 * It profiles the project's stack and indexes its code so the harness starts
 * with an accurate picture of what it is working in.
 */
import type { JobId } from "@anvil/shared";
import type { Embedder } from "../embeddings/embedder.js";
import type { EventBus } from "../events/bus.js";
import type { Workspace } from "../lib/workspace.js";
import type { StateStore } from "../state/store.js";
import { CodeIndexer } from "./indexer.js";
import { buildProjectProfile, saveProfile } from "./profiler.js";
import type { CodeHit, IngestionResult } from "./types.js";

export interface WorkspaceIngestorDeps {
  store: StateStore;
  embedder: Embedder;
  bus?: EventBus;
}

export class WorkspaceIngestor {
  private readonly indexer: CodeIndexer;
  private readonly bus: EventBus | undefined;

  constructor(deps: WorkspaceIngestorDeps) {
    this.indexer = new CodeIndexer({ store: deps.store, embedder: deps.embedder });
    this.bus = deps.bus;
  }

  /** Ingest a workspace: profile the stack, then index the code. */
  async ingest(workspace: Workspace, jobId?: JobId): Promise<IngestionResult> {
    const profile = buildProjectProfile(workspace);
    saveProfile(workspace, profile);
    const index = await this.indexer.indexWorkspace(workspace);
    if (this.bus && jobId) {
      this.bus.publish(
        jobId,
        "ingest.completed",
        "info",
        `Ingested "${profile.name}": ${profile.stack.languages.join(", ") || "unknown stack"}; ` +
          `${index.chunks} code chunks indexed.`,
        { name: profile.name, files: index.files, chunks: index.chunks },
      );
    }
    return { profile, index };
  }

  /** Semantic search over the indexed code. */
  search(query: string, topK?: number): Promise<CodeHit[]> {
    return this.indexer.search(query, topK);
  }
}
