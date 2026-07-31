import type { RuntimeConfig } from "../config/schema.js";
import { resolveAccount } from "../config/loader.js";
import { RuntimeError } from "../core/errors.js";
import { OkxClient } from "../core/okx-client.js";
import { resultMeta, type AccountCredentials, type OkxEnvironment, type ToolResult } from "../core/types.js";
import type { AccountStore } from "./store.js";

export class AccountService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly client: OkxClient,
    private readonly store?: AccountStore
  ) {}

  account(name?: string): AccountCredentials {
    return resolveAccount(this.config, name);
  }

  async verify(name?: string): Promise<ToolResult<Record<string, unknown>>> {
    const account = this.account(name);
    const [config] = await this.client.privateGet<Record<string, unknown>>("/api/v5/account/config", account);
    return this.wrap(account, config ?? {});
  }

  async getBalances(name?: string, ccy?: string): Promise<ToolResult<unknown[]>> {
    const account = this.account(name);
    const cached = recent(this.store?.balances.get(account.name));
    if (cached && !ccy) return this.wrap(account, cached.value, "websocket");
    return this.wrap(account, await this.client.privateGet("/api/v5/account/balance", account, { ccy }));
  }

  async getPositions(name?: string, instId?: string): Promise<ToolResult<unknown[]>> {
    const account = this.account(name);
    const cached = recent(this.store?.positions.get(account.name));
    if (cached) {
      const rows = instId ? cached.value.filter((item) => item.instId === instId) : cached.value;
      return this.wrap(account, rows, "websocket");
    }
    return this.wrap(account, await this.client.privateGet("/api/v5/account/positions", account, { instId }));
  }

  async getOpenOrders(name?: string, instId?: string, instType?: string): Promise<ToolResult<Record<string, unknown>>> {
    const account = this.account(name);
    const cachedOrders = recent(this.store?.orders.get(account.name));
    const cachedAlgo = recent(this.store?.algoOrders.get(account.name));
    if (cachedOrders && cachedAlgo) {
      const filter = (rows: Array<Record<string, unknown>>) => instId ? rows.filter((item) => item.instId === instId) : rows;
      return this.wrap(account, { orders: filter(cachedOrders.value), algoOrders: filter(cachedAlgo.value) }, "websocket");
    }
    const [orders, trigger, conditional, trailing] = await Promise.all([
      this.client.privateGet("/api/v5/trade/orders-pending", account, { instType, instId }),
      this.client.privateGet("/api/v5/trade/orders-algo-pending", account, { ordType: "trigger", instId }),
      this.client.privateGet("/api/v5/trade/orders-algo-pending", account, { ordType: "conditional", instId }),
      this.client.privateGet("/api/v5/trade/orders-algo-pending", account, { ordType: "move_order_stop", instId })
    ]);
    return this.wrap(account, { orders, algoOrders: [...trigger, ...conditional, ...trailing] }, "mixed");
  }

  async getOrder(name: string | undefined, instId: string, ordId?: string, clOrdId?: string): Promise<ToolResult<unknown[]>> {
    const account = this.account(name);
    return this.wrap(account, await this.client.privateGet("/api/v5/trade/order", account, { instId, ordId, clOrdId }));
  }

  async getOrderHistory(name?: string, query: Record<string, unknown> = {}): Promise<ToolResult<unknown[]>> {
    const account = this.account(name);
    const path = query.archive === true ? "/api/v5/trade/orders-history-archive" : "/api/v5/trade/orders-history";
    const { archive: _archive, ...params } = query;
    return this.wrap(account, await this.client.privateGet(path, account, params));
  }

  async getFills(name?: string, query: Record<string, unknown> = {}): Promise<ToolResult<unknown[]>> {
    const account = this.account(name);
    const path = query.archive === true ? "/api/v5/trade/fills-history" : "/api/v5/trade/fills";
    const { archive: _archive, ...params } = query;
    return this.wrap(account, await this.client.privateGet(path, account, params));
  }

  async getBills(name?: string, query: Record<string, unknown> = {}): Promise<ToolResult<unknown[]>> {
    const account = this.account(name);
    const path = query.archive === true ? "/api/v5/account/bills-archive" : "/api/v5/account/bills";
    const { archive: _archive, ...params } = query;
    return this.wrap(account, await this.client.privateGet(path, account, params));
  }

  async getSnapshot(name?: string): Promise<ToolResult<Record<string, unknown>>> {
    const account = this.account(name);
    const [balances, positions, openOrders, config] = await Promise.all([
      this.getBalances(account.name),
      this.getPositions(account.name),
      this.getOpenOrders(account.name),
      this.verify(account.name)
    ]);
    return this.wrap(account, {
      balances: balances.data,
      positions: positions.data,
      openOrders: openOrders.data,
      config: config.data
    }, "mixed");
  }

  async getRisk(name?: string): Promise<ToolResult<Record<string, unknown>>> {
    const snapshot = await this.getSnapshot(name);
    const balanceContainers = snapshot.data.balances as Array<Record<string, unknown>>;
    const positions = snapshot.data.positions as Array<Record<string, unknown>>;
    const firstBalance = balanceContainers[0] ?? {};
    const details = Array.isArray(firstBalance.details) ? firstBalance.details as Array<Record<string, unknown>> : [];
    const totalEquity = numeric(firstBalance.totalEq);
    const available = details.reduce((sum, item) => sum + numeric(item.availEq ?? item.availBal), 0);
    const maintenanceMargin = positions.reduce((sum, item) => sum + numeric(item.maintMargin ?? item.mmr), 0);
    const notional = positions.reduce((sum, item) => sum + Math.abs(numeric(item.notionalUsd ?? item.notionalUsdForBorrow)), 0);
    return {
      data: { totalEquity, available, maintenanceMargin, grossNotionalUsd: notional, positionCount: positions.length },
      meta: { ...snapshot.meta, source: "derived" }
    };
  }

  private wrap<T>(account: AccountCredentials, data: T, source: "rest" | "mixed" | "websocket" = "rest"): ToolResult<T> {
    return {
      data,
      meta: resultMeta({ source, environment: account.environment, account: account.name })
    };
  }
}

export interface UnclassifiedAccountCredentials {
  name: string;
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export interface DetectedAccount {
  account: AccountCredentials;
  config: Record<string, unknown>;
}

export async function detectAccountEnvironment(
  client: Pick<OkxClient, "privateGet">,
  credentials: UnclassifiedAccountCredentials,
  preferred?: OkxEnvironment
): Promise<DetectedAccount> {
  const environments: OkxEnvironment[] = preferred === "demo" ? ["demo", "live"] : ["live", "demo"];
  let lastError: unknown;
  for (const environment of environments) {
    const account: AccountCredentials = { ...credentials, environment };
    try {
      const [config] = await client.privateGet<Record<string, unknown>>("/api/v5/account/config", account);
      return { account, config: config ?? {} };
    } catch (error) {
      lastError = error;
      if (error instanceof RuntimeError && !["AUTH", "PERMISSION", "OKX_REJECTED"].includes(error.code)) throw error;
    }
  }
  throw lastError ?? new RuntimeError("AUTH", "OKX account environment could not be detected");
}

function recent<T>(value: import("../core/types.js").TimedValue<T> | undefined): import("../core/types.js").TimedValue<T> | undefined {
  return value && Date.now() - value.receivedAt <= 15_000 ? value : undefined;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
