import { ProxyAgent } from "undici";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

export const OKX_REST_BASE_URL = "https://openapi.okx.com";
export const OKX_PUBLIC_WS_URL = "wss://ws.okx.com:8443/ws/v5/public";

export interface ConnectivityStep {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ConnectivityResult {
  ok: boolean;
  rest: ConnectivityStep;
  websocket: ConnectivityStep;
}

interface ConnectivityChecks {
  rest?: () => Promise<void>;
  websocket?: () => Promise<void>;
}

export async function checkOkxConnectivity(
  proxyUrl?: string,
  timeoutMs = 6_000,
  checks: ConnectivityChecks = {}
): Promise<ConnectivityResult> {
  const [rest, websocket] = await Promise.all([
    timedCheck(checks.rest ?? (() => checkRest(proxyUrl, timeoutMs))),
    timedCheck(checks.websocket ?? (() => checkWebSocket(proxyUrl, timeoutMs)))
  ]);
  return { ok: rest.ok && websocket.ok, rest, websocket };
}

async function checkRest(proxyUrl: string | undefined, timeoutMs: number): Promise<void> {
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  try {
    const response = await fetch(`${OKX_REST_BASE_URL}/api/v5/public/time`, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(dispatcher ? { dispatcher } : {})
    } as RequestInit & { dispatcher?: ProxyAgent });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { code?: string };
    if (body.code !== "0") throw new Error("unexpected OKX response");
  } finally {
    await dispatcher?.close();
  }
}

async function checkWebSocket(proxyUrl: string | undefined, timeoutMs: number): Promise<void> {
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(OKX_PUBLIC_WS_URL, agent ? { agent } : undefined);
    const timer = setTimeout(() => finish(new Error("connection timed out")), timeoutMs);
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate();
      agent?.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once("open", () => finish());
    socket.once("error", () => finish(new Error("connection failed")));
    socket.once("close", () => finish(new Error("connection closed before opening")));
  });
}

async function timedCheck(check: () => Promise<void>): Promise<ConnectivityStep> {
  const startedAt = Date.now();
  try {
    await check();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: safeErrorMessage(error)
    };
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "connection failed";
  return message.replace(/https?:\/\/[^\s/@]+@/gi, "https://***:***@").slice(0, 160);
}
