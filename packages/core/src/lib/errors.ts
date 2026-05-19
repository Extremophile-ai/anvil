/**
 * The Anvil error type. Every failure carries a machine-readable `code`, an
 * actionable message, and a `retryable` flag the self-healing layer consults.
 */

export type AnvilErrorCode =
  | "RUNTIME_ERROR"
  | "STEERING_CLOSED"
  | "NO_ACTIVE_RUN"
  | "PATH_OUTSIDE_WORKSPACE"
  | "WORKSPACE_NOT_FOUND"
  | "INVALID_INPUT"
  | "NOT_IMPLEMENTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_INVALID_TOKEN"
  | "TOOL_ERROR"
  | "MCP_ERROR"
  | "MCP_NOT_APPROVED"
  | "STATE_ERROR"
  | "MEMORY_ERROR"
  | "GIT_ERROR"
  | "SANDBOX_ERROR"
  | "RATE_LIMITED"
  | "CONTEXT_OVERFLOW"
  | "MAX_RETRIES_EXCEEDED";

export interface AnvilErrorOptions {
  /** True when the self-healing layer may safely retry the operation. */
  retryable?: boolean;
  /** Structured context to aid diagnosis. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AnvilError extends Error {
  readonly code: AnvilErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: AnvilErrorCode, message: string, options: AnvilErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AnvilError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

/** Extract a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** True when the error is one the harness may safely retry. */
export function isRetryable(err: unknown): boolean {
  return err instanceof AnvilError && err.retryable;
}
