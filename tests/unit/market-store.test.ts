import CRC32 from "crc-32";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketStore, type BookLevel } from "../../src/market/store.js";

describe("MarketStore", () => {
  afterEach(() => vi.useRealTimers());

  it("merges validated order-book updates and rejects sequence gaps", () => {
    const store = new MarketStore(10, 50);
    const bids: BookLevel[] = [["100", "1", "0", "1"]];
    const asks: BookLevel[] = [["101", "2", "0", "1"]];
    store.applyBook("BTC-USDT-SWAP", "snapshot", { bids, asks, ts: "1", seqId: 1, checksum: CRC32.str("100:1:101:2") });
    store.applyBook("BTC-USDT-SWAP", "update", {
      bids: [["100", "0", "0", "0"], ["99", "3", "0", "1"]],
      asks: [],
      ts: "2",
      prevSeqId: 1,
      seqId: 2,
      checksum: CRC32.str("99:3:101:2")
    });
    expect(store.books.get("BTC-USDT-SWAP")?.value.bids[0]?.[0]).toBe("99");
    expect(() => store.applyBook("BTC-USDT-SWAP", "update", { bids: [], asks: [], ts: "3", prevSeqId: 99, seqId: 100 }))
      .toThrow("sequence gap");
    expect(store.books.has("BTC-USDT-SWAP")).toBe(false);
  });

  it("deduplicates and bounds recent trades", () => {
    const store = new MarketStore(2, 5);
    store.appendTrades("BTC-USDT-SWAP", [
      { tradeId: "1", ts: "1" },
      { tradeId: "2", ts: "2" },
      { tradeId: "3", ts: "3" }
    ]);
    store.appendTrades("BTC-USDT-SWAP", [{ tradeId: "3", ts: "3" }]);
    expect(store.trades.get("BTC-USDT-SWAP")?.value.map((item) => item.tradeId)).toEqual(["3", "2"]);
  });

  it("releases idle on-demand subscriptions but keeps prewarmed instruments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = new MarketStore(10, 5);
    store.touch("BTC-USDT-SWAP", true);
    store.touch("SOL-USDT-SWAP");
    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(store.idleSubscriptions(15 * 60_000)).toEqual(["SOL-USDT-SWAP"]);
  });
});
