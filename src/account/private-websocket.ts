import crypto from "node:crypto";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { RuntimeConfig } from "../config/schema.js";
import type { AccountCredentials } from "../core/types.js";
import { AccountStore } from "./store.js";
import { resolveProxy } from "../network/proxy.js";

interface Connection {
  account: AccountCredentials;
  socket?: WebSocket;
  stopping: boolean;
  attempt: number;
  reconnect?: NodeJS.Timeout;
  heartbeat?: NodeJS.Timeout;
  authenticated: boolean;
  lastMessageAt?: number;
  lastError?: string;
}

export class PrivateAccountWebSockets {
  private readonly connections: Connection[];
  private readonly agent?: HttpsProxyAgent<string>;

  constructor(config: RuntimeConfig, private readonly store: AccountStore) {
    this.connections = Object.entries(config.accounts).map(([name, account]) => ({
      account: { name, ...account }, stopping: false, attempt: 0, authenticated: false
    }));
    const proxyUrl = resolveProxy(config.proxy.url).url;
    this.agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
  }

  start(): void {
    for (const connection of this.connections) this.connect(connection);
  }

  stop(): void {
    for (const connection of this.connections) {
      connection.stopping = true;
      if (connection.reconnect) clearTimeout(connection.reconnect);
      if (connection.heartbeat) clearInterval(connection.heartbeat);
      connection.socket?.close();
    }
  }

  status(): Array<Record<string, unknown>> {
    const states = ["connecting", "open", "closing", "closed"];
    return this.connections.map((connection) => ({
      account: connection.account.name,
      environment: connection.account.environment,
      state: connection.socket ? states[connection.socket.readyState] ?? "unknown" : "not-started",
      authenticated: connection.authenticated,
      reconnectAttempt: connection.attempt,
      lastMessageAt: connection.lastMessageAt ?? null,
      lastError: connection.lastError ?? null
    }));
  }

  private connect(connection: Connection): void {
    if (connection.stopping) return;
    const url = connection.account.environment === "demo"
      ? "wss://wspap.okx.com:8443/ws/v5/private"
      : "wss://ws.okx.com:8443/ws/v5/private";
    const socket = new WebSocket(url, this.agent ? { agent: this.agent } : undefined);
    connection.socket = socket;
    connection.authenticated = false;
    socket.on("open", () => socket.send(JSON.stringify({ op: "login", args: [loginArgs(connection.account)] })));
    socket.on("message", (buffer) => this.message(connection, buffer.toString()));
    socket.on("close", () => this.reconnect(connection));
    socket.on("error", (error) => {
      connection.lastError = error.message;
      socket.close();
    });
  }

  private reconnect(connection: Connection): void {
    if (connection.stopping || connection.reconnect) return;
    if (connection.heartbeat) clearInterval(connection.heartbeat);
    const delay = Math.min(30_000, 500 * 2 ** connection.attempt) + Math.floor(Math.random() * 500);
    connection.attempt += 1;
    connection.reconnect = setTimeout(() => {
      connection.reconnect = undefined;
      this.connect(connection);
    }, delay);
    connection.reconnect.unref();
  }

  private message(connection: Connection, text: string): void {
    if (text === "pong") return;
    connection.lastMessageAt = Date.now();
    let message: Record<string, unknown>;
    try { message = JSON.parse(text) as Record<string, unknown>; } catch { return; }
    if (message.event === "login" && message.code === "0") {
      connection.attempt = 0;
      connection.authenticated = true;
      connection.lastError = undefined;
      connection.socket?.send(JSON.stringify({
        op: "subscribe",
        args: [
          { channel: "account" },
          { channel: "positions", instType: "ANY" },
          { channel: "orders", instType: "ANY" },
          { channel: "orders-algo", instType: "ANY" }
        ]
      }));
      connection.heartbeat = setInterval(() => {
        if (connection.socket?.readyState === WebSocket.OPEN) connection.socket.send("ping");
      }, 20_000);
      connection.heartbeat.unref();
      return;
    }
    if (message.event === "login" && message.code !== "0") {
      connection.authenticated = false;
      connection.lastError = String(message.msg ?? `Login failed with code ${String(message.code ?? "unknown")}`);
    }
    const arg = message.arg as Record<string, unknown> | undefined;
    const data = Array.isArray(message.data) ? message.data as Array<Record<string, unknown>> : [];
    if (!arg?.channel || !data.length) return;
    if (arg.channel === "account") this.store.setBalances(connection.account.name, data);
    else if (arg.channel === "positions") this.store.mergePositions(connection.account.name, data);
    else if (arg.channel === "orders") this.store.mergeOrders(connection.account.name, data);
    else if (arg.channel === "orders-algo") this.store.mergeOrders(connection.account.name, data, true);
  }
}

function loginArgs(account: AccountCredentials): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const sign = crypto.createHmac("sha256", account.secretKey)
    .update(`${timestamp}GET/users/self/verify`)
    .digest("base64");
  return { apiKey: account.apiKey, passphrase: account.passphrase, timestamp, sign };
}
