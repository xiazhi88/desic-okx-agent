import type { RuntimeConfig } from "../config/schema.js";
import { RuntimeError } from "../core/errors.js";
import { OkxClient } from "../core/okx-client.js";
import { resultMeta, type TimedValue, type ToolResult } from "../core/types.js";
import type { RuntimeDatabase } from "../storage/database.js";
import { calculateIndicators } from "./indicators.js";
import { MarketStore, type OrderBookSnapshot, type RawCandle, type RawMarketRow } from "./store.js";
import type { MarketWebSocket } from "./websocket.js";

const FRESH_MS = {
  ticker: 5_000,
  instrument: 3_600_000,
  book: 3_000,
  trades: 10_000,
  candle: 10_000,
  funding: 600_000,
  mark: 5_000,
  openInterest: 10_000
} as const;

export class MarketService {
  private websocket?: MarketWebSocket;

  constructor(
    readonly config: RuntimeConfig,
    readonly store: MarketStore,
    readonly client: OkxClient,
    readonly database: RuntimeDatabase
  ) {}

  attachWebSocket(websocket: MarketWebSocket): void {
    this.websocket = websocket;
  }

  restorePersisted(): void {
    for (const instId of this.config.market.prewarm) {
      for (const bar of this.config.market.bars) {
        const candles = this.database.loadCandles(instId, bar, 300) as RawCandle[];
        if (candles.length) this.store.setCandles(instId, bar, candles, "sqlite");
      }
    }
  }

  async getTicker(instId: string): Promise<ToolResult<RawMarketRow>> {
    this.ensure(instId);
    let cached = fresh(this.store.tickers.get(instId), FRESH_MS.ticker);
    if (!cached) {
      const [value] = await this.client.publicGet<RawMarketRow>("/api/v5/market/ticker", { instId });
      if (!value) throw new RuntimeError("NOT_FOUND", `Ticker not found for ${instId}`);
      this.store.setTicker(instId, value, "rest");
      cached = this.store.tickers.get(instId)!;
    }
    return timedResult(cached);
  }

  async getInstrument(instId: string): Promise<ToolResult<RawMarketRow>> {
    let cached = fresh(this.store.instruments.get(instId), FRESH_MS.instrument);
    if (!cached) {
      const values = await this.client.publicGet<RawMarketRow>("/api/v5/public/instruments", {
        instType: instrumentType(instId),
        instId
      });
      const value = values.find((item) => item.instId === instId);
      if (!value) throw new RuntimeError("NOT_FOUND", `Instrument not found: ${instId}`);
      this.store.setInstrument(instId, value);
      cached = this.store.instruments.get(instId)!;
    }
    return timedResult(cached);
  }

  async getOrderBook(instId: string, depth = this.config.market.orderBookDepth): Promise<ToolResult<OrderBookSnapshot>> {
    this.ensure(instId);
    let cached = fresh(this.store.books.get(instId), FRESH_MS.book);
    if (!cached) {
      const [value] = await this.client.publicGet<Record<string, unknown>>("/api/v5/market/books", {
        instId,
        sz: Math.min(depth, 400)
      });
      if (!value) throw new RuntimeError("NOT_FOUND", `Order book not found for ${instId}`);
      this.store.setBook(instId, {
        bids: (value.bids ?? []) as OrderBookSnapshot["bids"],
        asks: (value.asks ?? []) as OrderBookSnapshot["asks"],
        ts: String(value.ts ?? Date.now()),
        ...(value.checksum !== undefined ? { checksum: Number(value.checksum) } : {}),
        ...(value.seqId !== undefined ? { seqId: Number(value.seqId) } : {})
      });
      cached = this.store.books.get(instId)!;
    }
    return { data: { ...cached.value, bids: cached.value.bids.slice(0, depth), asks: cached.value.asks.slice(0, depth) }, meta: meta(cached) };
  }

  async getRecentTrades(instId: string, limit = 100): Promise<ToolResult<RawMarketRow[]>> {
    this.ensure(instId);
    let cached = fresh(this.store.trades.get(instId), FRESH_MS.trades);
    if (!cached) {
      const values = await this.client.publicGet<RawMarketRow>("/api/v5/market/trades", { instId, limit: Math.min(limit, 500) });
      this.store.appendTrades(instId, values, "rest");
      cached = this.store.trades.get(instId)!;
    }
    return { data: cached.value.slice(0, limit), meta: meta(cached) };
  }

  async getCandles(instId: string, bar = "1m", limit = 100): Promise<ToolResult<RawCandle[]>> {
    this.ensure(instId);
    let cached = fresh(this.store.getCandles(instId, bar), FRESH_MS.candle);
    if (!cached || cached.value.length < limit) {
      const persisted = this.database.loadCandles(instId, bar, Math.max(limit, 300)) as RawCandle[];
      if (persisted.length) this.store.setCandles(instId, bar, persisted, "sqlite");
      const values = await this.client.publicGet<RawCandle>("/api/v5/market/candles", {
        instId,
        bar,
        limit: Math.min(limit, 300)
      });
      this.store.setCandles(instId, bar, [...values].reverse(), "rest");
      this.database.saveCandles(instId, bar, values.filter((row) => row[8] === "1"));
      cached = this.store.getCandles(instId, bar)!;
    }
    return { data: cached.value.slice(-limit), meta: meta(cached) };
  }

  async getFundingRate(instId: string): Promise<ToolResult<RawMarketRow>> {
    this.ensure(instId);
    let cached = fresh(this.store.fundingRates.get(instId), FRESH_MS.funding);
    if (!cached) {
      const [value] = await this.client.publicGet<RawMarketRow>("/api/v5/public/funding-rate", { instId });
      if (!value) throw new RuntimeError("NOT_FOUND", `Funding rate not found for ${instId}`);
      this.store.setFundingRate(instId, value, "rest");
      cached = this.store.fundingRates.get(instId)!;
    }
    return timedResult(cached);
  }

  async getMarkPrice(instId: string): Promise<ToolResult<RawMarketRow>> {
    this.ensure(instId);
    let cached = fresh(this.store.markPrices.get(instId), FRESH_MS.mark);
    if (!cached) {
      const [value] = await this.client.publicGet<RawMarketRow>("/api/v5/public/mark-price", {
        instType: instrumentType(instId),
        instId
      });
      if (!value) throw new RuntimeError("NOT_FOUND", `Mark price not found for ${instId}`);
      this.store.setMarkPrice(instId, value, "rest");
      cached = this.store.markPrices.get(instId)!;
    }
    return timedResult(cached);
  }

  async getOpenInterest(instId: string): Promise<ToolResult<RawMarketRow>> {
    this.ensure(instId);
    let cached = fresh(this.store.openInterest.get(instId), FRESH_MS.openInterest);
    if (!cached) {
      const [value] = await this.client.publicGet<RawMarketRow>("/api/v5/public/open-interest", {
        instType: instrumentType(instId),
        instId
      });
      if (!value) throw new RuntimeError("NOT_FOUND", `Open interest not found for ${instId}`);
      this.store.setOpenInterest(instId, value, "rest");
      cached = this.store.openInterest.get(instId)!;
    }
    return timedResult(cached);
  }

  async getIndicators(instId: string, bar = "1m", limit = 200): Promise<ToolResult<Record<string, unknown>>> {
    const candles = await this.getCandles(instId, bar, Math.max(30, limit));
    return { data: calculateIndicators(candles.data), meta: { ...candles.meta, source: "derived" } };
  }

  async getDecisionSnapshot(instId: string, bar = "1m", candleLimit = 100): Promise<ToolResult<Record<string, unknown>>> {
    const [ticker, instrument, book, trades, candles, fundingRate, markPrice, openInterest] = await Promise.all([
      this.getTicker(instId),
      this.getInstrument(instId),
      this.getOrderBook(instId),
      this.getRecentTrades(instId, 100),
      this.getCandles(instId, bar, candleLimit),
      this.getFundingRate(instId),
      this.getMarkPrice(instId),
      this.getOpenInterest(instId)
    ]);
    const parts = { ticker, instrument, orderBook: book, trades, candles, fundingRate, markPrice, openInterest };
    const dynamicParts = { ticker, orderBook: book, trades, candles, markPrice, openInterest };
    const observed = Object.values(dynamicParts).map((part) => part.meta.receivedAt);
    const maxTimeSkewMs = Math.max(...observed) - Math.min(...observed);
    const now = Date.now();
    const stale = Object.entries(dynamicParts)
      .filter(([, part]) => now - part.meta.receivedAt > 60_000)
      .map(([name]) => name);
    const consistent = maxTimeSkewMs <= this.config.market.maxSnapshotSkewMs && stale.length === 0;
    const warnings = [
      ...(consistent ? [] : [`Snapshot skew is ${maxTimeSkewMs}ms`]),
      ...(stale.length ? [`Stale components: ${stale.join(", ")}`] : [])
    ];
    const asOf = Math.max(...observed);
    return {
      data: {
        instId,
        bar,
        asOf,
        maxTimeSkewMs,
        consistent,
        components: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, { data: part.data, meta: part.meta }]))
      },
      meta: resultMeta({ source: "mixed", exchangeTs: asOf, receivedAt: now, warnings })
    };
  }

  async scanWatchlist(instIds = this.config.market.prewarm, bar = "5m"): Promise<ToolResult<unknown[]>> {
    const values = await Promise.all(instIds.map(async (instId) => {
      const [ticker, indicators] = await Promise.all([this.getTicker(instId), this.getIndicators(instId, bar, 100)]);
      return { instId, ticker: ticker.data, indicators: indicators.data, observedAt: ticker.meta.receivedAt };
    }));
    return { data: values, meta: resultMeta({ source: "mixed" }) };
  }

  private ensure(instId: string): void {
    if (!instId.trim()) throw new RuntimeError("VALIDATION", "instId is required");
    this.websocket?.ensureSubscribed(instId);
    this.store.touch(instId);
  }
}

function fresh<T>(value: TimedValue<T> | undefined, maxAgeMs: number): TimedValue<T> | undefined {
  return value && Date.now() - value.receivedAt <= maxAgeMs ? value : undefined;
}

function timedResult<T>(value: TimedValue<T>): ToolResult<T> {
  return { data: value.value, meta: meta(value) };
}

function meta<T>(value: TimedValue<T>) {
  return resultMeta({
    source: value.source,
    exchangeTs: value.exchangeTs,
    receivedAt: value.receivedAt
  });
}

function instrumentType(instId: string): string {
  if (instId.endsWith("-SWAP")) return "SWAP";
  const parts = instId.split("-");
  if (parts.length >= 3) return "FUTURES";
  return "SPOT";
}
