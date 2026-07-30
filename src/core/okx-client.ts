import crypto from "node:crypto";
import { ProxyAgent, type Dispatcher } from "undici";
import type { AccountCredentials, OkxEnvelope } from "./types.js";
import { applyOrderAttribution } from "./attribution.js";
import { classifyOkxError, RuntimeError } from "./errors.js";
import { sanitizeValue } from "./sanitize.js";

interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  account?: AccountCredentials;
  timeoutMs?: number;
  attributed?: boolean;
  headers?: Record<string, string>;
}

export class OkxClient {
  private timeOffsetMs = 0;
  private readonly dispatcher?: Dispatcher;

  constructor(
    private readonly baseUrl = "https://www.okx.com",
    proxyUrl?: string
  ) {
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  async publicGet<T = Record<string, unknown>>(path: string, query?: Record<string, unknown>): Promise<T[]> {
    return this.request<T>("GET", path, { query });
  }

  async privateGet<T = Record<string, unknown>>(
    path: string,
    account: AccountCredentials,
    query?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<T[]> {
    return this.request<T>("GET", path, { query, account, headers });
  }

  async privatePost<T = Record<string, unknown>>(
    path: string,
    account: AccountCredentials,
    body: unknown,
    attributed = false
  ): Promise<T[]> {
    return this.request<T>("POST", path, { body, account, attributed });
  }

  async syncTime(): Promise<void> {
    const sent = Date.now();
    const response = await this.request<{ ts: string }>("GET", "/api/v5/public/time", { timeoutMs: 5_000 });
    const received = Date.now();
    const server = Number(response[0]?.ts);
    if (Number.isFinite(server)) this.timeOffsetMs = server - Math.round((sent + received) / 2);
  }

  private async request<T>(method: "GET" | "POST", path: string, options: RequestOptions, retried = false): Promise<T[]> {
    const query = buildQuery(options.query);
    const requestPath = `${path}${query}`;
    const attributedBody = options.attributed ? applyOrderAttribution(path, options.body) : options.body;
    const body = method === "POST" ? JSON.stringify(attributedBody ?? {}) : "";
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", ...options.headers };
    if (options.account) this.sign(headers, method, requestPath, body, options.account);
    try {
      const response = await fetch(`${this.baseUrl}${requestPath}`, {
        method,
        headers,
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {})
      } as RequestInit & { dispatcher?: Dispatcher });
      const text = await response.text();
      let envelope: OkxEnvelope<T>;
      try {
        envelope = JSON.parse(text) as OkxEnvelope<T>;
      } catch {
        throw new RuntimeError("NETWORK", `OKX returned HTTP ${response.status} with an invalid response`, response.status >= 500);
      }
      const intelligenceSuccess = (path.startsWith("/api/v5/orbit/") || path.startsWith("/api/v5/journal/")) && envelope.code === "1";
      if (!response.ok || (envelope.code !== "0" && !intelligenceSuccess)) {
        if (envelope.code === "50102" && options.account && !retried) {
          await this.syncTime();
          return this.request<T>(method, path, options, true);
        }
        throw classifyOkxError(envelope.code || String(response.status), envelope.msg || text);
      }
      const rows = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
      return sanitizeValue(rows, options.account ? [options.account] : []);
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      const message = error instanceof Error ? error.message : "Unknown network failure";
      throw classifyOkxError("network", message);
    }
  }

  private sign(
    headers: Record<string, string>,
    method: string,
    requestPath: string,
    body: string,
    account: AccountCredentials
  ): void {
    const timestamp = new Date(Date.now() + this.timeOffsetMs).toISOString();
    const signature = crypto
      .createHmac("sha256", account.secretKey)
      .update(`${timestamp}${method}${requestPath}${body}`)
      .digest("base64");
    headers["OK-ACCESS-KEY"] = account.apiKey;
    headers["OK-ACCESS-SIGN"] = signature;
    headers["OK-ACCESS-TIMESTAMP"] = timestamp;
    headers["OK-ACCESS-PASSPHRASE"] = account.passphrase;
    if (account.environment === "demo") headers["x-simulated-trading"] = "1";
  }
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) params.set(key, value.join(","));
    else params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
