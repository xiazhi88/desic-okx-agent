import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccountService } from "../../src/account/service.js";
import { loadConfig } from "../../src/config/loader.js";
import { OkxClient } from "../../src/core/okx-client.js";
import { MarketService } from "../../src/market/service.js";
import { MarketStore } from "../../src/market/store.js";
import { RuntimeDatabase } from "../../src/storage/database.js";
import { TradeService } from "../../src/trade/service.js";

const enabled = process.env.RUN_OKX_DEMO_E2E === "1";

describe.skipIf(!enabled)("OKX Demo trading workflow", () => {
  it("places, reconciles, amends, cancels, fills, and closes orders", async () => {
    if (process.env.OKX_ENVIRONMENT !== "demo") throw new Error("This test is restricted to OKX Demo");
    const config = loadConfig();
    const client = new OkxClient("https://www.okx.com", config.proxy.url);
    const accountService = new AccountService(config, client);
    const account = accountService.account();
    if (account.environment !== "demo") throw new Error("The selected account is not an OKX Demo account");
    const database = new RuntimeDatabase(":memory:");
    const market = new MarketService(config, new MarketStore(1_000, 50), client, database);
    const trade = new TradeService(client, accountService, market, database);
    const instId = process.env.OKX_DEMO_INST_ID || "BTC-USDT-SWAP";
    let ordinaryOrderId: string | undefined;
    let algoOrderId: string | undefined;

    try {
      const [accountConfig, instrument, ticker] = await Promise.all([
        accountService.verify(account.name),
        market.getInstrument(instId),
        market.getTicker(instId)
      ]);
      const size = String(instrument.data.minSz ?? instrument.data.lotSz ?? "1");
      const tick = String(instrument.data.tickSz ?? "0.1");
      const last = Number(ticker.data.last);
      const positionSide = accountConfig.data.posMode === "long_short_mode" ? "long" as const : undefined;
      const limitPrice = align(last * 0.5, tick, "down");
      const amendedPrice = align(Number(limitPrice) - Number(tick), tick, "down");
      const prefix = crypto.randomUUID();

      const ordinary = await trade.placeOrder({
        account: account.name,
        executionKey: `${prefix}:ordinary`,
        instId,
        tdMode: "cross",
        side: "buy",
        ...(positionSide ? { posSide: positionSide } : {}),
        ordType: "limit",
        size,
        price: limitPrice
      });
      ordinaryOrderId = firstId(ordinary.data.orders, "ordId");
      expect(ordinaryOrderId).toBeTruthy();
      expect((await accountService.getOrder(account.name, instId, ordinaryOrderId)).data).not.toHaveLength(0);
      await trade.amendOrder({ account: account.name, executionKey: `${prefix}:amend`, instId, ordId: ordinaryOrderId, newPrice: amendedPrice });
      await trade.cancelOrder({ account: account.name, executionKey: `${prefix}:cancel`, instId, ordId: ordinaryOrderId });
      ordinaryOrderId = undefined;

      const algo = await trade.placeAlgoOrder({
        account: account.name,
        executionKey: `${prefix}:algo`,
        instId,
        tdMode: "cross",
        side: "buy",
        ...(positionSide ? { posSide: positionSide } : {}),
        ordType: "trigger",
        size,
        triggerPrice: align(last * 2, tick, "up"),
        orderPrice: "-1",
        triggerPriceType: "last"
      });
      algoOrderId = firstId(algo.data.orders, "algoId");
      expect(algoOrderId).toBeTruthy();
      if (!algoOrderId) throw new Error("OKX Demo did not return an algo order ID");
      await trade.cancelAlgoOrder({ account: account.name, executionKey: `${prefix}:cancel-algo`, instId, algoId: algoOrderId });
      algoOrderId = undefined;

      await trade.placeOrder({
        account: account.name,
        executionKey: `${prefix}:market`,
        instId,
        tdMode: "cross",
        side: "buy",
        ...(positionSide ? { posSide: positionSide } : {}),
        ordType: "market",
        size
      });
      await waitForPosition(accountService, account.name, instId, positionSide);
      await trade.closePosition({
        account: account.name,
        executionKey: `${prefix}:close`,
        instId,
        mgnMode: "cross",
        ...(positionSide ? { posSide: positionSide } : {}),
        autoCancel: true
      });
      expect(await waitForPosition(accountService, account.name, instId, positionSide, true)).toBe(false);
    } finally {
      if (ordinaryOrderId) await client.privatePost("/api/v5/trade/cancel-order", account, { instId, ordId: ordinaryOrderId }).catch(() => undefined);
      if (algoOrderId) await client.privatePost("/api/v5/trade/cancel-algos", account, [{ instId, algoId: algoOrderId }]).catch(() => undefined);
      await trade.closeInstrumentPositions({ account: account.name, executionKey: `${crypto.randomUUID()}:cleanup`, instId }).catch(() => undefined);
      database.close();
    }
  }, 180_000);
});

function firstId(value: unknown, field: string): string | undefined {
  return Array.isArray(value) && value[0] && typeof value[0] === "object" ? String((value[0] as Record<string, unknown>)[field] ?? "") || undefined : undefined;
}

function align(value: number, stepText: string, mode: "down" | "up"): string {
  const step = Number(stepText);
  const decimals = stepText.split(".")[1]?.length ?? 0;
  const units = value / step;
  return ((mode === "down" ? Math.floor(units) : Math.ceil(units)) * step).toFixed(decimals);
}

async function waitForPosition(service: AccountService, account: string, instId: string, posSide?: string, expectEmpty = false): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await service.getPositions(account, instId);
    const open = (result.data as Array<Record<string, unknown>>).some((position) => Number(position.pos ?? 0) !== 0 && (!posSide || position.posSide === posSide));
    if (open !== expectEmpty) return open;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(expectEmpty ? "Demo position did not close" : "Demo position did not open");
}
