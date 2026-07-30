export type RuntimeErrorCode =
  | "AUTH"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "STALE_DATA"
  | "VALIDATION"
  | "OKX_REJECTED"
  | "NETWORK"
  | "AMBIGUOUS_WRITE"
  | "CAPABILITY_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL";

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function classifyOkxError(code: string, message: string): RuntimeError {
  const lower = message.toLowerCase();
  if (code === "50011") return new RuntimeError("RATE_LIMIT", "OKX rate limit exceeded", true);
  if (code === "50102") return new RuntimeError("AUTH", "OKX request timestamp expired", true);
  if (code.startsWith("501") || /api key|passphrase|signature|permission/.test(lower)) {
    return new RuntimeError(lower.includes("permission") ? "PERMISSION" : "AUTH", "OKX authentication or permission rejected");
  }
  if (/timeout|timed out|network|socket|fetch failed/.test(lower)) {
    return new RuntimeError("NETWORK", "OKX is temporarily unreachable", true);
  }
  return new RuntimeError("OKX_REJECTED", `OKX rejected the request (${code})`, false, { okxCode: code });
}

export function publicError(error: unknown): Record<string, unknown> {
  if (error instanceof RuntimeError) {
    return { code: error.code, message: error.message, retryable: error.retryable, details: error.details ?? {} };
  }
  return { code: "INTERNAL", message: error instanceof Error ? error.message : "Unknown runtime error", retryable: false };
}
