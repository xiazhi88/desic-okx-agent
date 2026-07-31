import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { RuntimeConfig } from "../config/schema.js";
import type { RuntimeDatabase } from "../storage/database.js";
import { MarketStore, type BookLevel, type OrderBookSnapshot, type RawCandle, type RawMarketRow } from "./store.js";
import { resolveProxy } from "../network/proxy.js";

interface OkxWsMessage {
  event?: string;
  arg?: { channel?: string; instId?: string };
  action?: string;
  data?: unknown[];
}

export class MarketWebSocket {
  private socket?: WebSocket;
  private businessSocket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private businessReconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private businessHeartbeatTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private businessReconnectAttempt = 0;
  private stopping = false;
  private readonly agent?: HttpsProxyAgent<string>;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: MarketStore,
    private readonly database: RuntimeDatabase,
    private readonly onBookInvalid?: (instId: string) => void
  ) {
    const proxyUrl = resolveProxy(config.proxy.url).url;
    this.agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
  }

  start(): void {
    this.stopping = false;
    for (const instId of this.config.market.prewarm) this.store.touch(instId, true);
    this.connect();
    this.connectBusiness();
    this.idleTimer = setInterval(() => this.releaseIdle(), 60_000);
    this.idleTimer.unref();
  }

  stop(): void {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.businessReconnectTimer) clearTimeout(this.businessReconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.businessHeartbeatTimer) clearInterval(this.businessHeartbeatTimer);
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.socket?.close();
    this.businessSocket?.close();
  }

  ensureSubscribed(instId: string): void {
    const isNew = this.store.touch(instId);
    if (isNew) {
      if (this.socket?.readyState === WebSocket.OPEN) this.subscribe([instId]);
      if (this.businessSocket?.readyState === WebSocket.OPEN) this.subscribeBusiness([instId]);
    }
  }

  status(): Record<string, unknown> {
    return {
      public: socketStatus(this.socket, this.reconnectAttempt),
      business: socketStatus(this.businessSocket, this.businessReconnectAttempt)
    };
  }

  private connect(): void {
    if (this.stopping) return;
    const socket = new WebSocket("wss://ws.okx.com:8443/ws/v5/public", this.agent ? { agent: this.agent } : undefined);
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.subscribe([...this.store.subscriptions.keys()]);
      this.heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 20_000);
      this.heartbeatTimer.unref();
    });
    socket.on("message", (buffer) => this.handleMessage(buffer.toString()));
    socket.on("close", () => this.scheduleReconnect());
    socket.on("error", () => socket.close());
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt) + Math.floor(Math.random() * 500);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private connectBusiness(): void {
    if (this.stopping) return;
    const socket = new WebSocket("wss://ws.okx.com:8443/ws/v5/business", this.agent ? { agent: this.agent } : undefined);
    this.businessSocket = socket;
    socket.on("open", () => {
      this.businessReconnectAttempt = 0;
      this.subscribeBusiness([...this.store.subscriptions.keys()]);
      this.businessHeartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 20_000);
      this.businessHeartbeatTimer.unref();
    });
    socket.on("message", (buffer) => this.handleMessage(buffer.toString()));
    socket.on("close", () => this.scheduleBusinessReconnect());
    socket.on("error", () => socket.close());
  }

  private scheduleBusinessReconnect(): void {
    if (this.stopping || this.businessReconnectTimer) return;
    if (this.businessHeartbeatTimer) clearInterval(this.businessHeartbeatTimer);
    const delay = Math.min(30_000, 500 * 2 ** this.businessReconnectAttempt) + Math.floor(Math.random() * 500);
    this.businessReconnectAttempt += 1;
    this.businessReconnectTimer = setTimeout(() => {
      this.businessReconnectTimer = undefined;
      this.connectBusiness();
    }, delay);
    this.businessReconnectTimer.unref();
  }

  private subscribe(instIds: string[]): void {
    const args = instIds.flatMap((instId) => publicSubscriptionArgs(instId));
    for (let offset = 0; offset < args.length; offset += 50) {
      this.socket?.send(JSON.stringify({ op: "subscribe", args: args.slice(offset, offset + 50) }));
    }
  }

  private subscribeBusiness(instIds: string[]): void {
    const args = instIds.flatMap((instId) => businessSubscriptionArgs(instId, this.config.market.bars));
    for (let offset = 0; offset < args.length; offset += 50) {
      this.businessSocket?.send(JSON.stringify({ op: "subscribe", args: args.slice(offset, offset + 50) }));
    }
  }

  private unsubscribe(instId: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ op: "unsubscribe", args: publicSubscriptionArgs(instId) }));
    if (this.businessSocket?.readyState === WebSocket.OPEN) this.businessSocket.send(JSON.stringify({ op: "unsubscribe", args: businessSubscriptionArgs(instId, this.config.market.bars) }));
  }

  private releaseIdle(): void {
    for (const instId of this.store.idleSubscriptions(this.config.market.idleSubscriptionMs)) {
      this.unsubscribe(instId);
      this.store.removeSubscription(instId);
    }
  }

  private handleMessage(text: string): void {
    if (text === "pong") return;
    let message: OkxWsMessage;
    try {
      message = JSON.parse(text) as OkxWsMessage;
    } catch {
      return;
    }
    const channel = message.arg?.channel;
    const instId = message.arg?.instId;
    if (!channel || !instId || !Array.isArray(message.data)) return;
    const rows = message.data as RawMarketRow[];
    try {
      if (channel === "tickers" && rows[0]) this.store.setTicker(instId, rows[0]);
      else if (channel === "trades") this.store.appendTrades(instId, rows);
      else if (channel === "funding-rate" && rows[0]) this.store.setFundingRate(instId, rows[0]);
      else if (channel === "mark-price" && rows[0]) this.store.setMarkPrice(instId, rows[0]);
      else if (channel === "open-interest" && rows[0]) this.store.setOpenInterest(instId, rows[0]);
      else if (channel === "books" && rows[0]) {
        const row = rows[0];
        this.store.applyBook(instId, message.action ?? "update", {
          bids: (row.bids ?? []) as BookLevel[],
          asks: (row.asks ?? []) as BookLevel[],
          ts: String(row.ts ?? Date.now()),
          ...(row.checksum !== undefined ? { checksum: Number(row.checksum) } : {}),
          ...(row.seqId !== undefined ? { seqId: Number(row.seqId) } : {})
          , ...(row.prevSeqId !== undefined ? { prevSeqId: Number(row.prevSeqId) } : {})
        } satisfies OrderBookSnapshot);
      } else if (channel.startsWith("candle")) {
        const bar = channel.slice("candle".length);
        const candles = message.data as RawCandle[];
        this.store.setCandles(instId, bar, candles);
        const closed = candles.filter((candle) => candle[8] === "1");
        if (closed.length) this.database.saveCandles(instId, bar, closed);
      }
    } catch {
      if (channel === "books") {
        this.onBookInvalid?.(instId);
        this.unsubscribe(instId);
        setTimeout(() => this.subscribe([instId]), 250).unref();
      }
    }
  }
}

function socketStatus(socket: WebSocket | undefined, reconnectAttempt: number): Record<string, unknown> {
  const states = ["connecting", "open", "closing", "closed"];
  return {
    state: socket ? states[socket.readyState] ?? "unknown" : "not-started",
    reconnectAttempt
  };
}

function publicSubscriptionArgs(instId: string): Array<Record<string, string>> {
  return [
    { channel: "tickers", instId },
    { channel: "books", instId },
    { channel: "trades", instId },
    { channel: "funding-rate", instId },
    { channel: "mark-price", instId },
    { channel: "open-interest", instId }
  ];
}

function businessSubscriptionArgs(instId: string, bars: string[]): Array<Record<string, string>> {
  return bars.map((bar) => ({ channel: `candle${bar}`, instId }));
}
