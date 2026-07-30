import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/schema.js";
import type { OkxClient } from "../../src/core/okx-client.js";
import { MarketService } from "../../src/market/service.js";
import { MarketStore } from "../../src/market/store.js";
import type { RuntimeDatabase } from "../../src/storage/database.js";

describe("warm market snapshot", () => {
  it("backfills a cold ticker once and then serves it from memory", async () => {
    const store = new MarketStore(1_000, 50);
    const client = { publicGet: vi.fn(async () => [{ instId: "SOL-USDT-SWAP", last: "150", ts: String(Date.now()) }]) } as unknown as OkxClient;
    const database = { loadCandles: vi.fn(() => []), saveCandles: vi.fn() } as unknown as RuntimeDatabase;
    const service = new MarketService(structuredClone(DEFAULT_CONFIG), store, client, database);
    const first = await service.getTicker("SOL-USDT-SWAP");
    const second = await service.getTicker("SOL-USDT-SWAP");
    expect(first.data.last).toBe("150");
    expect(second.meta.source).toBe("rest");
    expect(client.publicGet).toHaveBeenCalledTimes(1);
  });

  it("uses only memory and stays below the local p95 target", async () => {
    const store = new MarketStore(1_000, 50);
    const instId = "BTC-USDT-SWAP";
    store.setTicker(instId, { instId, last: "100", ts: String(Date.now()) });
    store.setInstrument(instId, { instId, lotSz: "1", minSz: "1", tickSz: "0.1", ts: String(Date.now()) });
    store.setBook(instId, { bids: [["99", "1", "0", "1"]], asks: [["101", "1", "0", "1"]], ts: String(Date.now()) });
    store.appendTrades(instId, [{ tradeId: "1", px: "100", ts: String(Date.now()) }]);
    store.setCandles(instId, "1m", [[String(Date.now() - 60_000), "99", "101", "98", "100", "1", "1", "1", "0"]]);
    store.setFundingRate(instId, { instId, fundingRate: "0.0001", ts: String(Date.now()) });
    store.setMarkPrice(instId, { instId, markPx: "100", ts: String(Date.now()) });
    store.setOpenInterest(instId, { instId, oi: "1000", ts: String(Date.now()) });
    const client = { publicGet: vi.fn(() => { throw new Error("REST should not be called"); }) } as unknown as OkxClient;
    const database = { loadCandles: vi.fn(() => []), saveCandles: vi.fn() } as unknown as RuntimeDatabase;
    const service = new MarketService(structuredClone(DEFAULT_CONFIG), store, client, database);
    const durations: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const start = performance.now();
      const snapshot = await service.getDecisionSnapshot(instId, "1m", 1);
      durations.push(performance.now() - start);
      expect(snapshot.data.consistent).toBe(true);
    }
    durations.sort((a, b) => a - b);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(50);
    expect(client.publicGet).not.toHaveBeenCalled();
  });

  it("does not include slow-moving reference data in the live skew", async () => {
    const store = new MarketStore(1_000, 50);
    const instId = "BTC-USDT-SWAP";
    const now = Date.now();
    store.setTicker(instId, { instId, last: "100", ts: String(now) });
    store.setInstrument(instId, { instId, lotSz: "1", minSz: "1", tickSz: "0.1", ts: String(now - 300_000) });
    store.setBook(instId, { bids: [["99", "1", "0", "1"]], asks: [["101", "1", "0", "1"]], ts: String(now) });
    store.appendTrades(instId, [{ tradeId: "1", px: "100", ts: String(now) }]);
    store.setCandles(instId, "1m", [[String(now - 60_000), "99", "101", "98", "100", "1", "1", "1", "0"]]);
    store.setFundingRate(instId, { instId, fundingRate: "0.0001", ts: String(now - 300_000) });
    store.setMarkPrice(instId, { instId, markPx: "100", ts: String(now) });
    store.setOpenInterest(instId, { instId, oi: "1000", ts: String(now) });
    store.instruments.get(instId)!.receivedAt = now - 300_000;
    store.fundingRates.get(instId)!.receivedAt = now - 300_000;
    const client = { publicGet: vi.fn(() => { throw new Error("REST should not be called"); }) } as unknown as OkxClient;
    const database = { loadCandles: vi.fn(() => []), saveCandles: vi.fn() } as unknown as RuntimeDatabase;
    const service = new MarketService(structuredClone(DEFAULT_CONFIG), store, client, database);
    const snapshot = await service.getDecisionSnapshot(instId, "1m", 1);
    expect(snapshot.data.consistent).toBe(true);
    expect(snapshot.data.maxTimeSkewMs).toBeLessThanOrEqual(DEFAULT_CONFIG.market.maxSnapshotSkewMs);
    expect(client.publicGet).not.toHaveBeenCalled();
  });
});
