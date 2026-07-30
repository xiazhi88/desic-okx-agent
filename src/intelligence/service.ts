import crypto from "node:crypto";
import type { AccountService } from "../account/service.js";
import type { AccountCredentials, ToolResult } from "../core/types.js";
import { resultMeta } from "../core/types.js";
import { RuntimeError } from "../core/errors.js";
import type { OkxClient } from "../core/okx-client.js";
import type { DerivativesService } from "../derivatives/service.js";
import type { MarketService } from "../market/service.js";
import type { RuntimeDatabase } from "../storage/database.js";
import type { RuntimeConfig } from "../config/schema.js";

const PATHS = {
  news: "/api/v5/orbit/news-search",
  newsDetail: "/api/v5/orbit/news-detail",
  newsSources: "/api/v5/orbit/news-platform",
  sentiment: "/api/v5/orbit/currency-sentiment-query",
  sentimentRanking: "/api/v5/orbit/currency-sentiment-ranking",
  calendar: "/api/v5/public/economic-calendar",
  traders: "/api/v5/orbit/public/leaderboard",
  traderSearch: "/api/v5/orbit/top-trader-search",
  positions: "/api/v5/orbit/public/position-current",
  positionHistory: "/api/v5/orbit/public/position-history",
  orderHistory: "/api/v5/orbit/public/trade-records",
  signalOverview: "/api/v5/journal/smartmoney/overview",
  signalTrend: "/api/v5/journal/smartmoney/signal-history"
} as const;

export class IntelligenceService {
  private readonly pollTimers = new Set<NodeJS.Timeout>();
  private polling = false;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly client: OkxClient,
    private readonly accounts: AccountService,
    private readonly database: RuntimeDatabase,
    private readonly market: MarketService,
    private readonly derivatives: DerivativesService
  ) {}

  start(): void {
    if (!this.config.defaultAccount || this.config.accounts[this.config.defaultAccount]?.environment !== "live") return;
    this.polling = true;
    this.schedulePoll(this.config.intelligence.newsPollSeconds * 1_000, () => this.newsList({ account: this.config.defaultAccount, limit: 50 }));
    this.schedulePoll(this.config.intelligence.sentimentPollMinutes * 60_000, () => this.sentimentRanking({ account: this.config.defaultAccount, limit: 50 }));
    this.schedulePoll(this.config.intelligence.smartMoneyPollMinutes * 60_000, () => this.smart("list_traders", { account: this.config.defaultAccount, limit: 50 }));
  }

  stop(): void {
    this.polling = false;
    for (const timer of this.pollTimers) clearTimeout(timer);
    this.pollTimers.clear();
  }

  async newsList(args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    return this.fetchExperimental("news", PATHS.news, args, {
      sortBy: args.sortBy ?? (args.keyword ? "relevant" : "latest"),
      keyword: args.keyword,
      importance: args.importance,
      platform: args.platform,
      ccyList: csv(args.coins),
      sentiment: args.sentiment,
      begin: args.begin,
      end: args.end,
      detailLvl: args.detailLevel ?? "summary",
      limit: clamp(args.limit, 1, 100, 30),
      cursor: args.after
    });
  }

  async newsDetail(args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    if (!args.id) throw new RuntimeError("VALIDATION", "id is required");
    return this.fetchExperimental("news_detail", PATHS.newsDetail, args, { id: args.id });
  }

  async newsSources(args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    return this.fetchExperimental("news_source", PATHS.newsSources, args, {});
  }

  async sentiment(args: Record<string, unknown>, trend = false): Promise<ToolResult<unknown[]>> {
    const coins = csv(args.coins ?? args.ccy);
    if (!coins) throw new RuntimeError("VALIDATION", "coins is required");
    return this.fetchExperimental("sentiment", PATHS.sentiment, args, {
      ccy: coins,
      period: args.period ?? (trend ? "1h" : "24h"),
      inclTrend: trend ? "true" : undefined,
      limit: trend ? clamp(args.limit, 1, 500, 24) : undefined
    });
  }

  async sentimentRanking(args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    return this.fetchExperimental("sentiment_ranking", PATHS.sentimentRanking, args, {
      period: args.period ?? "24h",
      sortBy: args.sortBy ?? "hot",
      limit: clamp(args.limit, 1, 50, 20)
    });
  }

  async economicCalendar(args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    return this.fetchExperimental("calendar", PATHS.calendar, args, {
      region: args.region,
      importance: args.importance,
      before: args.begin,
      after: args.end,
      limit: clamp(args.limit, 1, 100, 50)
    });
  }

  listEvents(args: Record<string, unknown>): ToolResult<unknown[]> {
    const since = Number(args.since ?? Date.now() - 7 * 86_400_000);
    const articles = this.database.queryIntelligence("news", 1_000, since) as Array<Record<string, unknown>>;
    const events = clusterNews(articles).slice(0, clamp(args.limit, 1, 200, 50));
    return { data: events, meta: resultMeta({ source: "derived" }) };
  }

  readEvent(args: Record<string, unknown>): ToolResult<unknown> {
    if (!args.id) throw new RuntimeError("VALIDATION", "id is required");
    const event = (this.listEvents({ limit: 1_000 }).data as Array<Record<string, unknown>>).find((item) => item.id === args.id);
    if (!event) throw new RuntimeError("NOT_FOUND", `News event '${String(args.id)}' was not found`);
    return { data: event, meta: resultMeta({ source: "derived" }) };
  }

  async marketReaction(args: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
    const event = this.readEvent(args).data as Record<string, unknown>;
    const coins = Array.isArray(event.coins) ? event.coins.map(String) : [];
    const instId = String(args.instId ?? `${coins[0] ?? "BTC"}-USDT-SWAP`);
    const candles = await this.market.getCandles(instId, String(args.bar ?? "5m"), clamp(args.limit, 20, 300, 100));
    const rows = candles.data;
    const first = Number(rows[0]?.[4]);
    const last = Number(rows.at(-1)?.[4]);
    return {
      data: { event, instId, from: first, to: last, absoluteChange: last - first, percentChange: first ? (last - first) / first : null, candles: rows },
      meta: { ...candles.meta, source: "derived" }
    };
  }

  async anomalies(args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    const instId = String(args.instId ?? "BTC-USDT-SWAP");
    const changes = await this.derivatives.positionChanges({ instId, period: String(args.period ?? "5m"), limit: clamp(args.limit, 10, 100, 50) });
    const threshold = Number(args.threshold ?? 0.03);
    const data = (changes.data as Array<Record<string, unknown>>).filter((item) => Math.abs(Number(item.percentChange ?? 0)) >= threshold);
    return { data, meta: { ...changes.meta, source: "derived" } };
  }

  async dailyBriefing(args: Record<string, unknown>): Promise<ToolResult<Record<string, unknown>>> {
    const instId = String(args.instId ?? "BTC-USDT-SWAP");
    const [news, ranking, derivatives] = await Promise.all([
      this.newsList({ ...args, limit: clamp(args.newsLimit, 1, 100, 30) }),
      this.sentimentRanking({ ...args, limit: 20 }),
      this.derivatives.decisionSnapshot({ instId, period: String(args.period ?? "5m"), limit: 50 })
    ]);
    return { data: { asOf: Date.now(), instId, news: news.data, sentimentRanking: ranking.data, derivatives: derivatives.data }, meta: resultMeta({ source: "mixed" }) };
  }

  async smart(operation: SmartOperation, args: Record<string, unknown>): Promise<ToolResult<unknown[]>> {
    const mapping = smartRequest(operation, args);
    return this.fetchExperimental(`smart:${operation}`, mapping.path, args, mapping.query);
  }

  private async fetchExperimental(
    kind: string,
    path: string,
    args: Record<string, unknown>,
    query: Record<string, unknown>
  ): Promise<ToolResult<unknown[]>> {
    if (args.localOnly === true) return this.local(kind, args);
    const account = this.liveAccount(typeof args.account === "string" ? args.account : undefined);
    try {
      const data = await this.client.privateGet<Record<string, unknown>>(path, account, query, {
        "Accept-Language": typeof args.language === "string" ? args.language : "en-US"
      });
      this.persist(kind, data);
      return {
        data,
        meta: resultMeta({ source: "rest", account: account.name, environment: account.environment })
      };
    } catch (error) {
      const local = this.database.queryIntelligence(kind, clamp(args.limit, 1, 1_000, 100), Number(args.since ?? 0));
      if (local.length) {
        return {
          data: local,
          meta: resultMeta({ source: "sqlite", account: account.name, environment: account.environment, warnings: ["Remote intelligence capability is unavailable; returned local history"] })
        };
      }
      const message = error instanceof Error ? error.message : "Unknown upstream response";
      throw new RuntimeError("CAPABILITY_UNAVAILABLE", `Experimental OKX intelligence capability is unavailable: ${message}`, true);
    }
  }

  private local(kind: string, args: Record<string, unknown>): ToolResult<unknown[]> {
    return {
      data: this.database.queryIntelligence(kind, clamp(args.limit, 1, 1_000, 100), Number(args.since ?? 0)),
      meta: resultMeta({ source: "sqlite" })
    };
  }

  private liveAccount(name?: string): AccountCredentials {
    const account = this.accounts.account(name);
    if (account.environment !== "live") {
      throw new RuntimeError("CAPABILITY_UNAVAILABLE", "News and Smart Money require a live read-only OKX account");
    }
    return account;
  }

  private persist(kind: string, data: unknown[]): void {
    for (const item of flattenItems(data)) {
      const timestamp = itemTimestamp(item) ?? Date.now();
      const id = itemId(kind, item);
      this.database.upsertIntelligence(kind, id, timestamp, item);
    }
  }

  private schedulePoll(intervalMs: number, operation: () => Promise<unknown>): void {
    let timer: NodeJS.Timeout;
    const run = (): void => {
      this.pollTimers.delete(timer);
      void operation().catch(() => undefined).finally(() => {
        if (!this.polling) return;
        timer = setTimeout(run, intervalMs);
        timer.unref();
        this.pollTimers.add(timer);
      });
    };
    timer = setTimeout(run, Math.min(5_000, intervalMs));
    timer.unref();
    this.pollTimers.add(timer);
  }
}

export type SmartOperation =
  | "list_traders"
  | "search_trader"
  | "read_performance"
  | "read_positions"
  | "read_position_history"
  | "read_order_history"
  | "read_signal_overview_by_filter"
  | "read_signal_overview_by_trader"
  | "read_signal_trend_by_filter"
  | "read_signal_trend_by_trader";

function smartRequest(operation: SmartOperation, args: Record<string, unknown>): { path: string; query: Record<string, unknown> } {
  const common = {
    sortType: args.sortType ?? "pnl",
    period: args.period ?? "7",
    pnl: args.pnl,
    winRatio: args.winRatio,
    maxRetreat: args.maxRetreat,
    asset: args.asset,
    lmtNum: args.lmtNum
  };
  switch (operation) {
    case "list_traders":
      return { path: PATHS.traders, query: { ...common, period: args.period ?? "90", after: args.after, before: args.before, limit: clamp(args.limit, 1, 100, 20) } };
    case "search_trader":
      return { path: PATHS.traderSearch, query: { keyword: args.keyword } };
    case "read_performance":
      return { path: PATHS.traders, query: { authorIds: csv(args.authorIds ?? args.authorId), sortType: args.sortType ?? "pnl", period: args.period ?? "90" } };
    case "read_positions":
      return { path: PATHS.positions, query: { authorId: args.authorId, instCcy: args.instId } };
    case "read_position_history":
      return { path: PATHS.positionHistory, query: { authorId: args.authorId, instCcy: args.instId, after: args.after, before: args.before, limit: clamp(args.limit, 1, 100, 50) } };
    case "read_order_history":
      return { path: PATHS.orderHistory, query: { authorId: args.authorId, instCcy: args.instId, after: args.after, before: args.before, limit: clamp(args.limit, 1, 100, 50) } };
    case "read_signal_overview_by_filter":
    case "read_signal_overview_by_trader":
      return { path: PATHS.signalOverview, query: { ...common, authorIds: csv(args.authorIds ?? args.authorId), instCcyList: csv(args.instCcyList), topInstruments: args.topInstruments ?? 20 } };
    case "read_signal_trend_by_filter":
    case "read_signal_trend_by_trader":
      return { path: PATHS.signalTrend, query: { ...common, authorIds: csv(args.authorIds ?? args.authorId), instId: args.instId, dataVersion: args.dataVersion, granularity: args.granularity ?? "1h", limit: clamp(args.limit, 1, 500, 24) } };
  }
}

function flattenItems(data: unknown[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      const nested = object.items ?? object.list ?? object.newsList ?? object.result;
      if (Array.isArray(nested)) nested.forEach(visit);
      else result.push(object);
    }
  };
  data.forEach(visit);
  return result;
}

function clusterNews(articles: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const sorted = [...articles].sort((a, b) => (itemTimestamp(b) ?? 0) - (itemTimestamp(a) ?? 0));
  const events: Array<{ id: string; title: string; coins: string[]; firstPublishedAt: number; lastPublishedAt: number; articles: Array<Record<string, unknown>>; tokens: Set<string> }> = [];
  for (const article of sorted) {
    const title = String(article.title ?? article.headline ?? article.name ?? "Untitled");
    const timestamp = itemTimestamp(article) ?? Date.now();
    const coins = values(article.coins ?? article.ccyList ?? article.ccy);
    const tokens = titleTokens(title);
    const match = events.find((event) => Math.abs(event.lastPublishedAt - timestamp) <= 12 * 3_600_000 && overlaps(event.coins, coins) && jaccard(event.tokens, tokens) >= 0.45);
    if (match) {
      match.articles.push(article);
      match.firstPublishedAt = Math.min(match.firstPublishedAt, timestamp);
      match.lastPublishedAt = Math.max(match.lastPublishedAt, timestamp);
      match.coins = [...new Set([...match.coins, ...coins])];
    } else {
      events.push({ id: itemId("event", { title, timestamp, coins }), title, coins, firstPublishedAt: timestamp, lastPublishedAt: timestamp, articles: [article], tokens });
    }
  }
  return events.map(({ tokens: _tokens, ...event }) => ({ ...event, articleCount: event.articles.length, sourceCount: new Set(event.articles.map((item) => String(item.platform ?? item.source ?? "unknown"))).size }));
}

function titleTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").split(/\s+/).filter((token) => token.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / (a.size + b.size - intersection);
}

function overlaps(a: string[], b: string[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((value) => b.includes(value));
}

function csv(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(",") || undefined;
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function itemTimestamp(item: Record<string, unknown>): number | undefined {
  const parsed = Number(item.publishTime ?? item.publishedAt ?? item.eventTime ?? item.ts ?? item.timestamp ?? item.updateTime);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function itemId(kind: string, item: unknown): string {
  if (item && typeof item === "object") {
    const object = item as Record<string, unknown>;
    const existing = object.id ?? object.newsId ?? object.authorId ?? object.eventId;
    if (existing) return String(existing);
  }
  return crypto.createHash("sha256").update(`${kind}:${JSON.stringify(item)}`).digest("hex").slice(0, 24);
}
