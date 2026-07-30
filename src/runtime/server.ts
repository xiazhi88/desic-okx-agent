import crypto from "node:crypto";
import http from "node:http";
import { loadConfig } from "../config/loader.js";
import { AccountService } from "../account/service.js";
import { AccountStore } from "../account/store.js";
import { PrivateAccountWebSockets } from "../account/private-websocket.js";
import { OkxClient } from "../core/okx-client.js";
import { publicError } from "../core/errors.js";
import { sanitizeValue } from "../core/sanitize.js";
import { PACKAGE_VERSION } from "../core/version.js";
import { OKX_REST_BASE_URL } from "../network/connectivity.js";
import { resolveProxy } from "../network/proxy.js";
import { DerivativesService } from "../derivatives/service.js";
import { IntelligenceService } from "../intelligence/service.js";
import { MarketService } from "../market/service.js";
import { MarketStore } from "../market/store.js";
import { MarketWebSocket } from "../market/websocket.js";
import { RuntimeDatabase } from "../storage/database.js";
import { TOOL_CATALOG, toolByName, type ToolContext } from "../tools/catalog.js";
import { TradeService } from "../trade/service.js";
import { acquireRuntimeLock, appendRuntimeLifecycle, releaseRuntimeFiles, writeRuntimeState, type RuntimeState } from "./state.js";

export class RuntimeServer {
  private readonly config = loadConfig();
  private readonly database = new RuntimeDatabase();
  private readonly proxy = resolveProxy(this.config.proxy.url);
  private readonly client = new OkxClient(OKX_REST_BASE_URL, this.proxy.url);
  private readonly store = new MarketStore(this.config.market.recentTradeLimit, this.config.market.orderBookDepth);
  private readonly market = new MarketService(this.config, this.store, this.client, this.database);
  private readonly websocket = new MarketWebSocket(this.config, this.store, this.database);
  private readonly accountStore = new AccountStore();
  private readonly privateWebSockets = new PrivateAccountWebSockets(this.config, this.accountStore);
  private readonly account = new AccountService(this.config, this.client, this.accountStore);
  private readonly derivatives = new DerivativesService(this.client, this.database);
  private readonly intelligence = new IntelligenceService(this.config, this.client, this.account, this.database, this.market, this.derivatives);
  private readonly trade = new TradeService(this.client, this.account, this.market, this.database);
  private readonly context: ToolContext = { market: this.market, account: this.account, derivatives: this.derivatives, intelligence: this.intelligence, trade: this.trade };
  private readonly token = crypto.randomBytes(32).toString("base64url");
  private readonly instanceId = crypto.randomUUID();
  private readonly lockDescriptor = acquireRuntimeLock();
  private server?: http.Server;
  private state?: RuntimeState;
  private closing = false;

  async start(): Promise<RuntimeState> {
    appendRuntimeLifecycle("server-starting", { instanceId: this.instanceId });
    this.database.retainIntelligence(this.config.intelligence.retentionDays);
    this.market.attachWebSocket(this.websocket);
    this.market.restorePersisted();
    this.websocket.start();
    this.privateWebSockets.start();
    this.intelligence.start();
    this.server = http.createServer((request, response) => void this.route(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Runtime did not bind a TCP port");
    this.state = {
      instanceId: this.instanceId,
      pid: process.pid,
      port: address.port,
      token: this.token,
      startedAt: Date.now(),
      version: PACKAGE_VERSION
    };
    writeRuntimeState(this.state);
    return this.state;
  }

  async stop(reason = "requested"): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    appendRuntimeLifecycle("server-stopping", { instanceId: this.instanceId, reason });
    this.websocket.stop();
    this.privateWebSockets.stop();
    this.intelligence.stop();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.database.close();
    releaseRuntimeFiles(this.lockDescriptor, this.instanceId);
    appendRuntimeLifecycle("server-stopped", { instanceId: this.instanceId, reason });
  }

  private async route(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (!this.authorized(request)) return this.send(response, 401, { error: { code: "AUTH", message: "Invalid runtime token" } });
    try {
      if (request.method === "GET" && request.url === "/health") {
        return this.send(response, 200, { ok: true, pid: process.pid, instanceId: this.instanceId, startedAt: this.state?.startedAt, subscriptions: this.store.subscriptions.size });
      }
      if (request.method === "GET" && request.url === "/v1/tools") {
        return this.send(response, 200, { tools: TOOL_CATALOG.map(({ name, description }) => ({ name, description })) });
      }
      if (request.method === "POST" && request.url === "/v1/call") {
        const body = await readJson(request) as { name?: unknown; input?: unknown };
        const definition = toolByName(String(body.name ?? ""));
        if (!definition) return this.send(response, 404, { error: { code: "NOT_FOUND", message: `Unknown tool '${String(body.name ?? "")}'` } });
        const input = definition.schema.parse(body.input ?? {}) as Record<string, unknown>;
        const result = await definition.execute(this.context, input);
        const accounts = Object.entries(this.config.accounts).map(([name, account]) => ({ name, ...account }));
        return this.send(response, 200, sanitizeValue({ result }, accounts));
      }
      if (request.method === "POST" && request.url === "/stop") {
        this.send(response, 200, { stopped: true });
        setImmediate(() => void this.stop("rpc-stop").then(() => process.exit(0)));
        return;
      }
      this.send(response, 404, { error: { code: "NOT_FOUND", message: "Runtime endpoint not found" } });
    } catch (error) {
      const accounts = Object.entries(this.config.accounts).map(([name, account]) => ({ name, ...account }));
      this.send(response, 400, sanitizeValue({ error: publicError(error) }, accounts));
    }
  }

  private authorized(request: http.IncomingMessage): boolean {
    return request.headers.authorization === `Bearer ${this.token}`;
  }

  private send(response: http.ServerResponse, status: number, value: unknown): void {
    if (response.writableEnded) return;
    response.statusCode = status;
    response.end(JSON.stringify(value));
  }
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export async function runRuntimeServer(): Promise<void> {
  const server = new RuntimeServer();
  await server.start();
  process.once("SIGINT", () => { void server.stop("SIGINT").finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void server.stop("SIGTERM").finally(() => process.exit(0)); });
}
