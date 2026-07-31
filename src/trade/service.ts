import crypto from "node:crypto";
import type { AccountService } from "../account/service.js";
import { RuntimeError } from "../core/errors.js";
import type { OkxClient } from "../core/okx-client.js";
import { resultMeta, type AccountCredentials, type ToolResult } from "../core/types.js";
import type { MarketService } from "../market/service.js";
import type { RuntimeDatabase } from "../storage/database.js";

export interface EvaluatePlanInput {
  instId: string;
  side: "buy" | "sell";
  size: string;
  price?: string;
  leverage?: string;
  stopLossPrice?: string;
}

export interface PlaceOrderInput {
  account?: string;
  executionKey: string;
  instId: string;
  tdMode: "cash" | "cross" | "isolated";
  side: "buy" | "sell";
  posSide?: "net" | "long" | "short";
  ordType: "limit" | "market" | "post_only" | "ioc" | "fok";
  size: string;
  price?: string;
  reduceOnly?: boolean;
  ccy?: string;
  targetCcy?: "base_ccy" | "quote_ccy";
}

export interface PlaceAlgoOrderInput {
  account?: string;
  executionKey: string;
  instId: string;
  tdMode: "cash" | "cross" | "isolated";
  side: "buy" | "sell";
  posSide?: "net" | "long" | "short";
  ordType: "trigger" | "conditional" | "trailing";
  size: string;
  triggerPrice?: string;
  orderPrice?: string;
  triggerPriceType?: "last" | "index" | "mark";
  takeProfitTriggerPrice?: string;
  takeProfitOrderPrice?: string;
  stopLossTriggerPrice?: string;
  stopLossOrderPrice?: string;
  callbackRatio?: string;
  callbackSpread?: string;
  activePrice?: string;
  reduceOnly?: boolean;
}

export class TradeService {
  constructor(
    private readonly client: OkxClient,
    private readonly accounts: AccountService,
    private readonly market: MarketService,
    private readonly database: RuntimeDatabase
  ) {}

  async evaluatePlan(input: EvaluatePlanInput): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const [instrumentResult, tickerResult] = await Promise.all([
      this.market.getInstrument(input.instId),
      this.market.getTicker(input.instId)
    ]);
    const instrument = instrumentResult.data;
    const contracts = number(input.size, "size");
    const referencePrice = input.price ? number(input.price, "price") : number(tickerResult.data.last, "ticker.last");
    const ctVal = optionalNumber(instrument.ctVal) ?? 1;
    const ctMult = optionalNumber(instrument.ctMult) ?? 1;
    const baseQuantity = contracts * ctVal * ctMult;
    const quoteNotional = baseQuantity * referencePrice;
    const leverage = input.leverage ? number(input.leverage, "leverage") : 1;
    const initialMargin = quoteNotional / leverage;
    const stopLoss = input.stopLossPrice ? number(input.stopLossPrice, "stopLossPrice") : null;
    const lossAtStop = stopLoss === null ? null : Math.abs(referencePrice - stopLoss) * baseQuantity;
    const normalizedSize = normalizeStep(contracts, String(instrument.lotSz ?? "1"), "down");
    return {
      data: {
        instId: input.instId,
        side: input.side,
        contracts,
        normalizedSize,
        referencePrice,
        baseQuantity,
        quoteNotional,
        leverage,
        estimatedInitialMargin: initialMargin,
        estimatedLossAtStop: lossAtStop,
        contractValue: ctVal,
        contractMultiplier: ctMult,
        contractValueCurrency: instrument.ctValCcy ?? null,
        lotSize: instrument.lotSz,
        minimumSize: instrument.minSz,
        tickSize: instrument.tickSz
      },
      meta: resultMeta({ source: "derived" })
    };
  }

  async precheck(input: PlaceOrderInput): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const [instrument, accountConfig, balances, positions, snapshot, plan] = await Promise.all([
      this.market.getInstrument(input.instId),
      this.accounts.verify(account.name),
      this.accounts.getBalances(account.name),
      this.accounts.getPositions(account.name, input.instId),
      this.market.getDecisionSnapshot(input.instId),
      this.evaluatePlan({ instId: input.instId, side: input.side, size: input.size, ...(input.price ? { price: input.price } : {}) })
    ]);
    const blockers: string[] = [];
    const warnings: string[] = [];
    if ((snapshot.data.consistent as boolean) !== true) blockers.push("Market decision snapshot is not time-consistent");
    const normalized = normalizeStep(number(input.size, "size"), String(instrument.data.lotSz ?? "1"), "down");
    if (!sameNumber(normalized, input.size)) blockers.push(`size must align with lotSz ${String(instrument.data.lotSz)}`);
    if (Number(input.size) < Number(instrument.data.minSz ?? 0)) blockers.push(`size is below minSz ${String(instrument.data.minSz)}`);
    if (input.ordType !== "market" && !input.price) blockers.push(`${input.ordType} requires price`);
    if (input.price) {
      const normalizedPrice = normalizeStep(number(input.price, "price"), String(instrument.data.tickSz ?? "0.1"), "nearest");
      if (!sameNumber(normalizedPrice, input.price)) blockers.push(`price must align with tickSz ${String(instrument.data.tickSz)}`);
    }
    const permissions = String(accountConfig.data.perm ?? "");
    if (permissions && !permissions.toLowerCase().includes("trade")) blockers.push("The OKX API key does not have trade permission");
    if (!permissions) warnings.push("OKX did not return a permission summary; the exchange will enforce the API key permission");
    return {
      data: {
        ok: blockers.length === 0,
        blockers,
        warnings,
        normalized: { size: normalized, price: input.price ?? null },
        plan: plan.data,
        account: { name: account.name, environment: account.environment, config: accountConfig.data },
        balances: balances.data,
        positions: positions.data,
        marketSnapshot: snapshot.data
      },
      meta: resultMeta({ source: "mixed", environment: account.environment, account: account.name, warnings })
    };
  }

  async precheckAlgo(input: PlaceAlgoOrderInput): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const [instrument, accountConfig, snapshot] = await Promise.all([
      this.market.getInstrument(input.instId),
      this.accounts.verify(account.name),
      this.market.getDecisionSnapshot(input.instId)
    ]);
    const blockers: string[] = [];
    const warnings: string[] = [];
    if ((snapshot.data.consistent as boolean) !== true) blockers.push("Market decision snapshot is not time-consistent");
    const normalizedSize = normalizeStep(number(input.size, "size"), String(instrument.data.lotSz ?? "1"), "down");
    if (!sameNumber(normalizedSize, input.size)) blockers.push(`size must align with lotSz ${String(instrument.data.lotSz)}`);
    if (Number(input.size) < Number(instrument.data.minSz ?? 0)) blockers.push(`size is below minSz ${String(instrument.data.minSz)}`);
    const priceFields: Array<[string, string | undefined, boolean]> = [
      ["triggerPrice", input.triggerPrice, false],
      ["orderPrice", input.orderPrice, true],
      ["takeProfitTriggerPrice", input.takeProfitTriggerPrice, false],
      ["takeProfitOrderPrice", input.takeProfitOrderPrice, true],
      ["stopLossTriggerPrice", input.stopLossTriggerPrice, false],
      ["stopLossOrderPrice", input.stopLossOrderPrice, true],
      ["activePrice", input.activePrice, false]
    ];
    for (const [field, value, allowsMarket] of priceFields) {
      if (value === undefined || (allowsMarket && value === "-1")) continue;
      const normalized = normalizeStep(number(value, field), String(instrument.data.tickSz ?? "0.1"), "nearest");
      if (!sameNumber(normalized, value)) blockers.push(`${field} must align with tickSz ${String(instrument.data.tickSz)}`);
    }
    if (input.ordType === "trigger" && (!input.triggerPrice || !input.orderPrice)) blockers.push("trigger requires triggerPrice and orderPrice");
    if (input.ordType === "conditional" && !(input.takeProfitTriggerPrice || input.stopLossTriggerPrice)) blockers.push("conditional requires a take-profit or stop-loss trigger price");
    if (input.takeProfitTriggerPrice && !input.takeProfitOrderPrice) blockers.push("takeProfitOrderPrice is required with takeProfitTriggerPrice");
    if (input.stopLossTriggerPrice && !input.stopLossOrderPrice) blockers.push("stopLossOrderPrice is required with stopLossTriggerPrice");
    if (input.ordType === "trailing" && !input.callbackRatio && !input.callbackSpread) blockers.push("trailing requires callbackRatio or callbackSpread");
    if (input.callbackRatio && input.callbackSpread) blockers.push("callbackRatio and callbackSpread are mutually exclusive");
    const permissions = String(accountConfig.data.perm ?? "");
    if (permissions && !permissions.toLowerCase().includes("trade")) blockers.push("The OKX API key does not have trade permission");
    if (!permissions) warnings.push("OKX did not return a permission summary; the exchange will enforce the API key permission");
    return {
      data: {
        ok: blockers.length === 0,
        blockers,
        warnings,
        normalized: { size: normalizedSize },
        account: { name: account.name, environment: account.environment, config: accountConfig.data },
        instrument: instrument.data,
        marketSnapshot: snapshot.data
      },
      meta: resultMeta({ source: "mixed", environment: account.environment, account: account.name, warnings })
    };
  }

  async setLeverage(input: { account?: string; executionKey: string; instId: string; lever: string; mgnMode: "cross" | "isolated"; posSide?: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const body = { instId: input.instId, lever: input.lever, mgnMode: input.mgnMode, ...(input.posSide ? { posSide: input.posSide } : {}) };
    return this.execute(account, input.executionKey, "set_leverage", body, async () => ({
      leverage: await this.client.privatePost("/api/v5/account/set-leverage", account, body)
    }), async () => {
      const rows = await this.client.privateGet<Record<string, unknown>>("/api/v5/account/leverage-info", account, {
        instId: input.instId,
        mgnMode: input.mgnMode
      });
      const matching = rows.filter((row) => String(row.lever) === input.lever && (!input.posSide || row.posSide === input.posSide));
      return matching.length ? { leverage: matching } : undefined;
    });
  }

  async placeOrder(input: PlaceOrderInput): Promise<ToolResult<Record<string, unknown>>> {
    const precheck = await this.precheck(input);
    if (!precheck.data.ok) throw new RuntimeError("VALIDATION", "Order precheck failed", false, { blockers: precheck.data.blockers });
    const account = this.accounts.account(input.account);
    const clOrdId = clientId(input.executionKey, "o");
    const body = {
      instId: input.instId,
      tdMode: input.tdMode,
      clOrdId,
      side: input.side,
      ...(input.posSide ? { posSide: input.posSide } : {}),
      ordType: input.ordType,
      sz: input.size,
      ...(input.price ? { px: input.price } : {}),
      ...(input.reduceOnly !== undefined ? { reduceOnly: input.reduceOnly } : {}),
      ...(input.ccy ? { ccy: input.ccy } : {}),
      ...(input.targetCcy ? { tgtCcy: input.targetCcy } : {})
    };
    return this.execute(account, input.executionKey, "place_order", body, async () => {
      const data = await this.client.privatePost("/api/v5/trade/order", account, body, true);
      return { orders: data, clOrdId };
    }, () => this.findOrder(account, input.instId, clOrdId));
  }

  async placeBatchOrders(input: { account?: string; executionKey: string; orders: Array<Omit<PlaceOrderInput, "account" | "executionKey">> }): Promise<ToolResult<Record<string, unknown>>> {
    if (input.orders.length < 1 || input.orders.length > 20) throw new RuntimeError("VALIDATION", "Batch orders must contain between 1 and 20 orders");
    const account = this.accounts.account(input.account);
    const checks = await Promise.all(input.orders.map((order, index) => this.precheck({ ...order, account: account.name, executionKey: `${input.executionKey}:${index}` })));
    const blockers = checks.flatMap((check, index) => (check.data.blockers as string[]).map((blocker) => `orders[${index}]: ${blocker}`));
    if (blockers.length) throw new RuntimeError("VALIDATION", "Batch order precheck failed", false, { blockers });
    const clientIds: string[] = [];
    const body = input.orders.map((order, index) => {
      const clOrdId = clientId(`${input.executionKey}:${index}`, "b");
      clientIds.push(clOrdId);
      return {
        instId: order.instId,
        tdMode: order.tdMode,
        clOrdId,
        side: order.side,
        ...(order.posSide ? { posSide: order.posSide } : {}),
        ordType: order.ordType,
        sz: order.size,
        ...(order.price ? { px: order.price } : {}),
        ...(order.reduceOnly !== undefined ? { reduceOnly: order.reduceOnly } : {}),
        ...(order.ccy ? { ccy: order.ccy } : {}),
        ...(order.targetCcy ? { tgtCcy: order.targetCcy } : {})
      };
    });
    return this.execute(account, input.executionKey, "place_batch_orders", body, async () => ({
      orders: await this.client.privatePost("/api/v5/trade/batch-orders", account, body, true),
      clOrdIds: clientIds
    }), async () => {
      const found = await Promise.all(input.orders.map((order, index) => this.findOrder(account, order.instId, clientIds[index]! ).catch(() => undefined)));
      return found.every(Boolean) ? { orders: found.flatMap((item) => item?.orders as unknown[] ?? []), clOrdIds: clientIds } : undefined;
    });
  }

  async amendOrder(input: { account?: string; executionKey: string; instId: string; ordId?: string; clOrdId?: string; newSize?: string; newPrice?: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const body = {
      instId: input.instId,
      ...(input.ordId ? { ordId: input.ordId } : {}),
      ...(input.clOrdId ? { clOrdId: input.clOrdId } : {}),
      reqId: clientId(input.executionKey, "a"),
      ...(input.newSize ? { newSz: input.newSize } : {}),
      ...(input.newPrice ? { newPx: input.newPrice } : {})
    };
    return this.execute(account, input.executionKey, "amend_order", body, async () => ({ orders: await this.client.privatePost("/api/v5/trade/amend-order", account, body) }), async () => {
      const remote = await this.findOrder(account, input.instId, input.clOrdId, input.ordId);
      const order = (remote?.orders as Array<Record<string, unknown>> | undefined)?.[0];
      if (!order) return undefined;
      if (input.newSize && String(order.sz) !== input.newSize) return undefined;
      if (input.newPrice && String(order.px) !== input.newPrice) return undefined;
      return remote;
    });
  }

  async cancelOrder(input: { account?: string; executionKey: string; instId: string; ordId?: string; clOrdId?: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const body = { instId: input.instId, ...(input.ordId ? { ordId: input.ordId } : {}), ...(input.clOrdId ? { clOrdId: input.clOrdId } : {}) };
    return this.execute(account, input.executionKey, "cancel_order", body, async () => ({ orders: await this.client.privatePost("/api/v5/trade/cancel-order", account, body) }), async () => {
      const remote = await this.findOrder(account, input.instId, input.clOrdId, input.ordId);
      const state = String((remote?.orders as Array<Record<string, unknown>> | undefined)?.[0]?.state ?? "");
      return ["canceled", "filled", "mmp_canceled"].includes(state) ? remote : undefined;
    });
  }

  async placeAlgoOrder(input: PlaceAlgoOrderInput): Promise<ToolResult<Record<string, unknown>>> {
    const precheck = await this.precheckAlgo(input);
    if (!precheck.data.ok) throw new RuntimeError("VALIDATION", "Algo order precheck failed", false, { blockers: precheck.data.blockers });
    const account = this.accounts.account(input.account);
    const algoClOrdId = clientId(input.executionKey, "g");
    const ordType = input.ordType === "trailing" ? "move_order_stop" : input.ordType;
    const body = {
      instId: input.instId,
      tdMode: input.tdMode,
      algoClOrdId,
      side: input.side,
      ...(input.posSide ? { posSide: input.posSide } : {}),
      ordType,
      sz: input.size,
      ...(input.triggerPrice ? { triggerPx: input.triggerPrice } : {}),
      ...(input.orderPrice ? { orderPx: input.orderPrice } : {}),
      ...(input.triggerPriceType ? { triggerPxType: input.triggerPriceType } : {}),
      ...(input.takeProfitTriggerPrice ? { tpTriggerPx: input.takeProfitTriggerPrice } : {}),
      ...(input.takeProfitOrderPrice ? { tpOrdPx: input.takeProfitOrderPrice } : {}),
      ...(input.stopLossTriggerPrice ? { slTriggerPx: input.stopLossTriggerPrice } : {}),
      ...(input.stopLossOrderPrice ? { slOrdPx: input.stopLossOrderPrice } : {}),
      ...(input.callbackRatio ? { callbackRatio: input.callbackRatio } : {}),
      ...(input.callbackSpread ? { callbackSpread: input.callbackSpread } : {}),
      ...(input.activePrice ? { activePx: input.activePrice } : {}),
      ...(input.reduceOnly !== undefined ? { reduceOnly: input.reduceOnly } : {})
    };
    return this.execute(account, input.executionKey, "place_algo_order", body, async () => ({
      orders: await this.client.privatePost("/api/v5/trade/order-algo", account, body, true),
      algoClOrdId
    }), () => this.findAlgoOrder(account, input.instId, undefined, algoClOrdId));
  }

  async amendAlgoOrder(input: { account?: string; executionKey: string; instId: string; algoId?: string; algoClOrdId?: string; newSize?: string; newTriggerPrice?: string; newOrderPrice?: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const body = {
      instId: input.instId,
      ...(input.algoId ? { algoId: input.algoId } : {}),
      ...(input.algoClOrdId ? { algoClOrdId: input.algoClOrdId } : {}),
      reqId: clientId(input.executionKey, "m"),
      ...(input.newSize ? { newSz: input.newSize } : {}),
      ...(input.newTriggerPrice ? { newTriggerPx: input.newTriggerPrice } : {}),
      ...(input.newOrderPrice ? { newOrdPx: input.newOrderPrice } : {})
    };
    return this.execute(account, input.executionKey, "amend_algo_order", body, async () => ({ orders: await this.client.privatePost("/api/v5/trade/amend-algos", account, body) }), () => this.findAlgoOrder(account, input.instId, input.algoId, input.algoClOrdId));
  }

  async cancelAlgoOrder(input: { account?: string; executionKey: string; instId: string; algoId: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const body = [{ instId: input.instId, algoId: input.algoId }];
    return this.execute(account, input.executionKey, "cancel_algo_order", body, async () => ({ orders: await this.client.privatePost("/api/v5/trade/cancel-algos", account, body) }), async () => {
      const remote = await this.findAlgoOrder(account, input.instId, input.algoId);
      const state = String((remote?.orders as Array<Record<string, unknown>> | undefined)?.[0]?.state ?? "");
      return ["canceled", "effective", "order_failed"].includes(state) ? remote : undefined;
    });
  }

  async closePosition(input: { account?: string; executionKey: string; instId: string; mgnMode: "cross" | "isolated"; posSide?: string; ccy?: string; autoCancel?: boolean }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const account = this.accounts.account(input.account);
    const clOrdId = clientId(input.executionKey, "c");
    const body = {
      instId: input.instId,
      mgnMode: input.mgnMode,
      ...(input.posSide ? { posSide: input.posSide } : {}),
      ...(input.ccy ? { ccy: input.ccy } : {}),
      autoCxl: input.autoCancel ?? false,
      clOrdId
    };
    return this.execute(account, input.executionKey, "close_position", body, async () => ({
      positions: await this.client.privatePost("/api/v5/trade/close-position", account, body, true),
      clOrdId
    }), async () => {
      const positions = await this.client.privateGet<Record<string, unknown>>("/api/v5/account/positions", account, { instId: input.instId });
      const remaining = positions.filter((position) => Number(position.pos ?? 0) !== 0 && (!input.posSide || position.posSide === input.posSide));
      return remaining.length === 0 ? { positions: [], clOrdId } : undefined;
    });
  }

  async cancelInstrumentOrders(input: { account?: string; executionKey: string; instId: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const open = await this.accounts.getOpenOrders(input.account, input.instId);
    const data = open.data as { orders: Array<Record<string, unknown>>; algoOrders: Array<Record<string, unknown>> };
    const ordinary = await Promise.all(data.orders.map((order, index) => this.cancelOrder({
      account: input.account,
      executionKey: `${input.executionKey}:order:${index}`,
      instId: input.instId,
      ...(order.ordId ? { ordId: String(order.ordId) } : { clOrdId: String(order.clOrdId) })
    })));
    const algo = await Promise.all(data.algoOrders.filter((order) => order.algoId).map((order, index) => this.cancelAlgoOrder({
      account: input.account,
      executionKey: `${input.executionKey}:algo:${index}`,
      instId: input.instId,
      algoId: String(order.algoId)
    })));
    return { data: { ordinary: ordinary.map((item) => item.data), algo: algo.map((item) => item.data) }, meta: open.meta };
  }

  async closeInstrumentPositions(input: { account?: string; executionKey: string; instId: string }): Promise<ToolResult<Record<string, unknown>>> {
    assertPerpetualSwap(input.instId);
    const positions = await this.accounts.getPositions(input.account, input.instId);
    const open = (positions.data as Array<Record<string, unknown>>).filter((position) => Number(position.pos ?? 0) !== 0);
    const results = await Promise.all(open.map((position, index) => this.closePosition({
      account: input.account,
      executionKey: `${input.executionKey}:position:${index}`,
      instId: input.instId,
      mgnMode: String(position.mgnMode ?? "cross") === "isolated" ? "isolated" : "cross",
      ...(position.posSide ? { posSide: String(position.posSide) } : {}),
      autoCancel: true
    })));
    return { data: { closed: results.map((item) => item.data) }, meta: positions.meta };
  }

  private async execute(
    account: AccountCredentials,
    executionKey: string,
    operation: string,
    request: unknown,
    submit: () => Promise<Record<string, unknown>>,
    reconcile?: () => Promise<Record<string, unknown> | undefined>
  ): Promise<ToolResult<Record<string, unknown>>> {
    if (!executionKey.trim()) throw new RuntimeError("VALIDATION", "executionKey is required");
    const requestHash = hash(request);
    const existing = this.database.beginExecution(executionKey, operation, requestHash);
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash) {
        throw new RuntimeError("VALIDATION", "executionKey was already used for a different request");
      }
      if (existing.status === "accepted" || existing.status === "reconciled") {
        return this.wrap(account, { ...(existing.response as Record<string, unknown>), replayed: true });
      }
      if (existing.status === "submitting" || existing.status === "ambiguous") {
        const remote = await reconcile?.();
        if (remote) {
          const response = { ...remote, reconciled: true };
          this.database.finishExecution(executionKey, "reconciled", response);
          return this.wrap(account, response);
        }
        throw new RuntimeError("AMBIGUOUS_WRITE", "The previous write has no confirmed terminal result; inspect the remote order before retrying");
      }
    }
    try {
      const response = await submit();
      this.database.finishExecution(executionKey, "accepted", response);
      return this.wrap(account, response);
    } catch (error) {
      if (error instanceof RuntimeError && error.code !== "NETWORK") {
        this.database.finishExecution(executionKey, "rejected", { error: error.message });
        throw error;
      }
      const remote = await reconcile?.().catch(() => undefined);
      if (remote) {
        const response = { ...remote, reconciled: true };
        this.database.finishExecution(executionKey, "reconciled", response);
        return this.wrap(account, response);
      }
      this.database.finishExecution(executionKey, "ambiguous", { error: "Remote result is unknown" });
      throw new RuntimeError("AMBIGUOUS_WRITE", "The OKX write response was ambiguous; remote reconciliation found no definitive result");
    }
  }

  private async findOrder(account: AccountCredentials, instId: string, clOrdId?: string, ordId?: string): Promise<Record<string, unknown> | undefined> {
    const orders = await this.client.privateGet<Record<string, unknown>>("/api/v5/trade/order", account, { instId, clOrdId, ordId });
    return orders[0] ? { orders, ...(clOrdId ? { clOrdId } : {}), ...(ordId ? { ordId } : {}) } : undefined;
  }

  private async findAlgoOrder(account: AccountCredentials, instId: string, algoId?: string, algoClOrdId?: string): Promise<Record<string, unknown> | undefined> {
    const orders = await this.client.privateGet<Record<string, unknown>>("/api/v5/trade/order-algo", account, { instId, algoId, algoClOrdId });
    return orders[0] ? { orders, ...(algoId ? { algoId } : {}), ...(algoClOrdId ? { algoClOrdId } : {}) } : undefined;
  }

  private wrap<T>(account: AccountCredentials, data: T): ToolResult<T> {
    return { data, meta: resultMeta({ source: "rest", account: account.name, environment: account.environment }) };
  }
}

function clientId(executionKey: string, prefix: string): string {
  const readable = executionKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18);
  const digest = crypto.createHash("sha256").update(executionKey).digest("hex").slice(0, 10);
  return `${prefix}${readable}${digest}`.slice(0, 32);
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeStep(value: number, stepText: string, mode: "down" | "nearest"): string {
  const step = number(stepText, "step");
  const scale = Math.max(decimalPlaces(stepText), 0);
  const quotient = value / step;
  const normalized = (mode === "down" ? Math.floor(quotient + 1e-12) : Math.round(quotient)) * step;
  return normalized.toFixed(scale);
}

function decimalPlaces(value: string): number {
  const normalized = value.toLowerCase();
  if (normalized.includes("e-")) return Number(normalized.split("e-")[1]);
  return normalized.split(".")[1]?.length ?? 0;
}

function number(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new RuntimeError("VALIDATION", `${field} must be a positive number`);
  return parsed;
}

function optionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameNumber(left: string, right: string): boolean {
  return Math.abs(Number(left) - Number(right)) <= Number.EPSILON * Math.max(1, Math.abs(Number(left)), Math.abs(Number(right)));
}

function assertPerpetualSwap(instId: string): void {
  if (!instId.endsWith("-SWAP")) {
    throw new RuntimeError("VALIDATION", "Trading tools support only OKX perpetual swap instruments ending in -SWAP");
  }
}
