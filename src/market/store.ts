import CRC32 from "crc-32";
import type { TimedValue } from "../core/types.js";
import { RuntimeError } from "../core/errors.js";

export type RawMarketRow = Record<string, unknown>;
export type RawCandle = string[];
export type BookLevel = [string, string, string, string];

export interface OrderBookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
  ts: string;
  checksum?: number;
  seqId?: number;
  prevSeqId?: number;
}

interface MutableBook {
  bids: Map<string, BookLevel>;
  asks: Map<string, BookLevel>;
  ts: string;
  checksum?: number;
  seqId?: number;
}

interface SubscriptionState {
  lastAccessAt: number;
  prewarmed: boolean;
}

export class MarketStore {
  readonly tickers = new Map<string, TimedValue<RawMarketRow>>();
  readonly instruments = new Map<string, TimedValue<RawMarketRow>>();
  readonly fundingRates = new Map<string, TimedValue<RawMarketRow>>();
  readonly markPrices = new Map<string, TimedValue<RawMarketRow>>();
  readonly openInterest = new Map<string, TimedValue<RawMarketRow>>();
  readonly books = new Map<string, TimedValue<OrderBookSnapshot>>();
  readonly trades = new Map<string, TimedValue<RawMarketRow[]>>();
  readonly candles = new Map<string, TimedValue<RawCandle[]>>();
  readonly subscriptions = new Map<string, SubscriptionState>();
  private readonly mutableBooks = new Map<string, MutableBook>();

  constructor(
    private readonly tradeLimit: number,
    private readonly bookDepth: number
  ) {}

  touch(instId: string, prewarmed = false): boolean {
    const current = this.subscriptions.get(instId);
    this.subscriptions.set(instId, {
      lastAccessAt: Date.now(),
      prewarmed: prewarmed || current?.prewarmed === true
    });
    return current === undefined;
  }

  idleSubscriptions(idleMs: number): string[] {
    const cutoff = Date.now() - idleMs;
    return [...this.subscriptions.entries()]
      .filter(([, state]) => !state.prewarmed && state.lastAccessAt < cutoff)
      .map(([instId]) => instId);
  }

  removeSubscription(instId: string): void {
    this.subscriptions.delete(instId);
  }

  status(now = Date.now()): Array<Record<string, unknown>> {
    return [...this.subscriptions.entries()].map(([instId, subscription]) => {
      const candleAges = [...this.candles.entries()]
        .filter(([key]) => key.startsWith(`${instId}:`))
        .map(([, value]) => now - value.receivedAt);
      return {
        instId,
        prewarmed: subscription.prewarmed,
        idleMs: Math.max(0, now - subscription.lastAccessAt),
        ageMs: {
          ticker: valueAge(this.tickers.get(instId), now),
          orderBook: valueAge(this.books.get(instId), now),
          trades: valueAge(this.trades.get(instId), now),
          fundingRate: valueAge(this.fundingRates.get(instId), now),
          markPrice: valueAge(this.markPrices.get(instId), now),
          openInterest: valueAge(this.openInterest.get(instId), now),
          candles: candleAges.length ? Math.min(...candleAges) : null
        }
      };
    });
  }

  setTicker(instId: string, value: RawMarketRow, source: TimedValue<unknown>["source"] = "websocket"): void {
    this.tickers.set(instId, timed(value, value.ts, source));
  }

  setInstrument(instId: string, value: RawMarketRow, source: TimedValue<unknown>["source"] = "rest"): void {
    this.instruments.set(instId, timed(value, value.ts, source));
  }

  setFundingRate(instId: string, value: RawMarketRow, source: TimedValue<unknown>["source"] = "websocket"): void {
    this.fundingRates.set(instId, timed(value, value.ts ?? value.fundingTime, source));
  }

  setMarkPrice(instId: string, value: RawMarketRow, source: TimedValue<unknown>["source"] = "websocket"): void {
    this.markPrices.set(instId, timed(value, value.ts, source));
  }

  setOpenInterest(instId: string, value: RawMarketRow, source: TimedValue<unknown>["source"] = "websocket"): void {
    this.openInterest.set(instId, timed(value, value.ts, source));
  }

  appendTrades(instId: string, incoming: RawMarketRow[], source: TimedValue<unknown>["source"] = "websocket"): void {
    const previous = this.trades.get(instId)?.value ?? [];
    const byId = new Map<string, RawMarketRow>();
    for (const trade of [...incoming, ...previous]) {
      const id = String(trade.tradeId ?? `${trade.ts}:${trade.px}:${trade.side}`);
      if (!byId.has(id)) byId.set(id, trade);
    }
    const values = [...byId.values()]
      .sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0))
      .slice(0, this.tradeLimit);
    this.trades.set(instId, timed(values, values[0]?.ts, source));
  }

  setCandles(instId: string, bar: string, incoming: RawCandle[], source: TimedValue<unknown>["source"] = "websocket"): void {
    const key = candleKey(instId, bar);
    const previous = this.candles.get(key)?.value ?? [];
    const byTimestamp = new Map<string, RawCandle>();
    for (const candle of [...incoming, ...previous]) {
      if (candle[0] && !byTimestamp.has(candle[0])) byTimestamp.set(candle[0], candle);
    }
    const values = [...byTimestamp.values()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .slice(-1_000);
    const receivedAt = Date.now();
    this.candles.set(key, { value: values, exchangeTs: receivedAt, receivedAt, source });
  }

  getCandles(instId: string, bar: string): TimedValue<RawCandle[]> | undefined {
    return this.candles.get(candleKey(instId, bar));
  }

  applyBook(instId: string, action: string, update: OrderBookSnapshot): void {
    const next = action === "snapshot" || !this.mutableBooks.has(instId)
      ? { bids: new Map(), asks: new Map(), ts: update.ts, checksum: update.checksum, seqId: update.seqId }
      : this.mutableBooks.get(instId)!;
    if (action !== "snapshot" && update.seqId !== undefined && next.seqId !== undefined && update.seqId <= next.seqId) return;
    if (action !== "snapshot" && update.prevSeqId !== undefined && next.seqId !== undefined && update.prevSeqId !== next.seqId && update.prevSeqId !== -1) {
      this.mutableBooks.delete(instId);
      this.books.delete(instId);
      throw new RuntimeError("STALE_DATA", `Order book sequence gap for ${instId}`, true);
    }
    applyLevels(next.bids, update.bids);
    applyLevels(next.asks, update.asks);
    next.ts = update.ts;
    next.checksum = update.checksum;
    next.seqId = update.seqId;
    if (update.checksum !== undefined && bookChecksum(next) !== update.checksum) {
      this.mutableBooks.delete(instId);
      this.books.delete(instId);
      throw new RuntimeError("STALE_DATA", `Order book checksum mismatch for ${instId}`, true);
    }
    this.mutableBooks.set(instId, next);
    const value = materializeBook(next, this.bookDepth);
    this.books.set(instId, timed(value, update.ts, "websocket"));
  }

  setBook(instId: string, book: OrderBookSnapshot, source: TimedValue<unknown>["source"] = "rest"): void {
    const mutable: MutableBook = { bids: new Map(), asks: new Map(), ts: book.ts, checksum: book.checksum, seqId: book.seqId };
    applyLevels(mutable.bids, book.bids);
    applyLevels(mutable.asks, book.asks);
    this.mutableBooks.set(instId, mutable);
    this.books.set(instId, timed(materializeBook(mutable, this.bookDepth), book.ts, source));
  }
}

function valueAge(value: TimedValue<unknown> | undefined, now: number): number | null {
  return value ? Math.max(0, now - value.receivedAt) : null;
}

export function candleKey(instId: string, bar: string): string {
  return `${instId}:${bar}`;
}

function timed<T>(value: T, timestamp: unknown, source: TimedValue<T>["source"]): TimedValue<T> {
  const receivedAt = Date.now();
  const parsed = Number(timestamp);
  return { value, exchangeTs: Number.isFinite(parsed) ? parsed : receivedAt, receivedAt, source };
}

function applyLevels(target: Map<string, BookLevel>, levels: BookLevel[]): void {
  for (const level of levels) {
    const price = level[0];
    if (!price) continue;
    if (Number(level[1]) === 0) target.delete(price);
    else target.set(price, level);
  }
}

function materializeBook(book: MutableBook, depth: number): OrderBookSnapshot {
  return {
    bids: [...book.bids.values()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, depth),
    asks: [...book.asks.values()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, depth),
    ts: book.ts,
    ...(book.checksum !== undefined ? { checksum: book.checksum } : {}),
    ...(book.seqId !== undefined ? { seqId: book.seqId } : {})
  };
}

function bookChecksum(book: MutableBook): number {
  const bids = [...book.bids.values()].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 25);
  const asks = [...book.asks.values()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 25);
  const values: string[] = [];
  const length = Math.max(bids.length, asks.length);
  for (let index = 0; index < length; index += 1) {
    const bid = bids[index];
    const ask = asks[index];
    if (bid) values.push(bid[0], bid[1]);
    if (ask) values.push(ask[0], ask[1]);
  }
  return CRC32.str(values.join(":"));
}
