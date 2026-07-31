import { z } from "zod";
import type { AccountService } from "../account/service.js";
import type { DerivativesService, DerivativesQuery } from "../derivatives/service.js";
import type { IntelligenceService, SmartOperation } from "../intelligence/service.js";
import type { MarketService } from "../market/service.js";
import type { PlaceAlgoOrderInput, PlaceOrderInput, TradeService } from "../trade/service.js";

export interface ToolContext {
  market: MarketService;
  account: AccountService;
  derivatives: DerivativesService;
  intelligence: IntelligenceService;
  trade: TradeService;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject;
  execute: (context: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

const InstId = z.string().min(1).describe("OKX instrument ID, for example BTC-USDT-SWAP");
const Account = z.string().min(1).optional().describe("Configured account alias; the default account is used when omitted");
const ExecutionKey = z.string().min(1).max(128).describe("Stable idempotency key chosen by the caller");
const Limit = z.number().int().positive().optional();
const Bar = z.string().min(1).optional();

const InstrumentSchema = z.strictObject({ instId: InstId });
const MarketListSchema = z.strictObject({ instId: InstId, limit: Limit });
const CandleSchema = z.strictObject({ instId: InstId, bar: Bar, limit: Limit });
const WatchlistSchema = z.strictObject({ instIds: z.array(InstId).optional(), bar: Bar });
const DerivativesSchema = z.strictObject({
  instId: InstId,
  period: z.string().optional(),
  begin: z.number().int().optional(),
  end: z.number().int().optional(),
  limit: Limit
});
const AccountOnlySchema = z.strictObject({ account: Account });
const AccountInstSchema = z.strictObject({ account: Account, instId: InstId.optional(), instType: z.string().optional() });
const HistorySchema = z.strictObject({
  account: Account,
  instType: z.string().optional(),
  instId: InstId.optional(),
  ordType: z.string().optional(),
  state: z.string().optional(),
  ccy: z.string().optional(),
  type: z.string().optional(),
  subType: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  begin: z.number().int().optional(),
  end: z.number().int().optional(),
  limit: Limit,
  archive: z.boolean().optional()
});

const IntelligenceSchema = z.strictObject({
  account: Account,
  language: z.string().optional(),
  localOnly: z.boolean().optional(),
  id: z.string().optional(),
  keyword: z.string().optional(),
  coins: z.union([z.string(), z.array(z.string())]).optional(),
  ccy: z.string().optional(),
  importance: z.string().optional(),
  platform: z.string().optional(),
  sentiment: z.string().optional(),
  sortBy: z.string().optional(),
  detailLevel: z.string().optional(),
  period: z.string().optional(),
  region: z.string().optional(),
  instId: z.string().optional(),
  bar: z.string().optional(),
  begin: z.number().int().optional(),
  end: z.number().int().optional(),
  since: z.number().int().optional(),
  after: z.string().optional(),
  limit: Limit,
  newsLimit: Limit,
  threshold: z.number().positive().optional()
});

const SmartSchema = z.strictObject({
  account: Account,
  language: z.string().optional(),
  localOnly: z.boolean().optional(),
  keyword: z.string().optional(),
  authorId: z.string().optional(),
  authorIds: z.union([z.string(), z.array(z.string())]).optional(),
  instId: z.string().optional(),
  instCcyList: z.union([z.string(), z.array(z.string())]).optional(),
  sortType: z.string().optional(),
  period: z.string().optional(),
  pnl: z.string().optional(),
  winRatio: z.string().optional(),
  maxRetreat: z.string().optional(),
  asset: z.string().optional(),
  lmtNum: z.number().int().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  topInstruments: z.number().int().optional(),
  dataVersion: z.string().optional(),
  granularity: z.string().optional(),
  since: z.number().int().optional(),
  limit: Limit
});

const EvaluateSchema = z.strictObject({
  instId: InstId,
  side: z.enum(["buy", "sell"]),
  size: z.string().min(1),
  price: z.string().optional(),
  leverage: z.string().optional(),
  stopLossPrice: z.string().optional()
});
const PlaceOrderSchema = z.strictObject({
  account: Account,
  executionKey: ExecutionKey,
  instId: InstId,
  tdMode: z.enum(["cash", "cross", "isolated"]),
  side: z.enum(["buy", "sell"]),
  posSide: z.enum(["net", "long", "short"]).optional(),
  ordType: z.enum(["limit", "market", "post_only", "ioc", "fok"]),
  size: z.string().min(1),
  price: z.string().optional(),
  reduceOnly: z.boolean().optional(),
  ccy: z.string().optional(),
  targetCcy: z.enum(["base_ccy", "quote_ccy"]).optional()
});
const BatchOrderItemSchema = PlaceOrderSchema.omit({ account: true, executionKey: true });
const PlaceAlgoSchema = z.strictObject({
  account: Account,
  executionKey: ExecutionKey,
  instId: InstId,
  tdMode: z.enum(["cash", "cross", "isolated"]),
  side: z.enum(["buy", "sell"]),
  posSide: z.enum(["net", "long", "short"]).optional(),
  ordType: z.enum(["trigger", "conditional", "trailing"]),
  size: z.string().min(1),
  triggerPrice: z.string().optional(),
  orderPrice: z.string().optional(),
  triggerPriceType: z.enum(["last", "index", "mark"]).optional(),
  takeProfitTriggerPrice: z.string().optional(),
  takeProfitOrderPrice: z.string().optional(),
  stopLossTriggerPrice: z.string().optional(),
  stopLossOrderPrice: z.string().optional(),
  callbackRatio: z.string().optional(),
  callbackSpread: z.string().optional(),
  activePrice: z.string().optional(),
  reduceOnly: z.boolean().optional()
});

export const TOOL_CATALOG: ToolDefinition[] = [
  tool("market_get_ticker", "Read the latest ticker from the shared market runtime.", InstrumentSchema, (c, a) => c.market.getTicker(String(a.instId))),
  tool("market_get_instrument", "Read OKX instrument specifications and trading increments.", InstrumentSchema, (c, a) => c.market.getInstrument(String(a.instId))),
  tool("market_get_order_book", "Read the current validated order book.", z.strictObject({ instId: InstId, depth: z.number().int().min(1).max(400).optional() }), (c, a) => c.market.getOrderBook(String(a.instId), numberOr(a.depth, c.market.config.market.orderBookDepth))),
  tool("market_get_recent_trades", "Read recent public trades from the shared runtime.", MarketListSchema, (c, a) => c.market.getRecentTrades(String(a.instId), numberOr(a.limit, 100))),
  tool("market_get_candles", "Read current and closed OKX candles with local history backfill.", CandleSchema, (c, a) => c.market.getCandles(String(a.instId), stringOr(a.bar, "1m"), numberOr(a.limit, 100))),
  tool("market_get_funding_rate", "Read the current perpetual funding rate.", InstrumentSchema, (c, a) => c.market.getFundingRate(String(a.instId))),
  tool("market_get_mark_price", "Read the latest mark price.", InstrumentSchema, (c, a) => c.market.getMarkPrice(String(a.instId))),
  tool("market_get_open_interest", "Read the latest open interest.", InstrumentSchema, (c, a) => c.market.getOpenInterest(String(a.instId))),
  tool("market_get_indicators", "Calculate common indicators from locally cached candles.", CandleSchema, (c, a) => c.market.getIndicators(String(a.instId), stringOr(a.bar, "1m"), numberOr(a.limit, 200))),
  tool("market_get_decision_snapshot", "Read a time-aligned market snapshot for analysis or precheck.", CandleSchema, (c, a) => c.market.getDecisionSnapshot(String(a.instId), stringOr(a.bar, "1m"), numberOr(a.limit, 100))),
  tool("market_scan_watchlist", "Scan configured or supplied instruments with ticker and indicators.", WatchlistSchema, (c, a) => c.market.scanWatchlist(a.instIds as string[] | undefined, stringOr(a.bar, "5m"))),

  ...derivativeTools(),
  ...newsTools(),
  ...smartTools(),

  tool("account_get_snapshot", "Read balances, positions, orders, and account configuration together.", AccountOnlySchema, (c, a) => c.account.getSnapshot(optionalString(a.account))),
  tool("account_get_balances", "Read OKX account balances.", z.strictObject({ account: Account, ccy: z.string().optional() }), (c, a) => c.account.getBalances(optionalString(a.account), optionalString(a.ccy))),
  tool("account_get_positions", "Read current OKX positions.", AccountInstSchema, (c, a) => c.account.getPositions(optionalString(a.account), optionalString(a.instId))),
  tool("account_get_open_orders", "Read pending ordinary and algo orders.", AccountInstSchema, (c, a) => c.account.getOpenOrders(optionalString(a.account), optionalString(a.instId), optionalString(a.instType))),
  tool("account_get_order", "Read one order by exchange or client order ID.", z.strictObject({ account: Account, instId: InstId, ordId: z.string().optional(), clOrdId: z.string().optional() }), (c, a) => c.account.getOrder(optionalString(a.account), String(a.instId), optionalString(a.ordId), optionalString(a.clOrdId))),
  tool("account_get_order_history", "Read recent or archived order history.", HistorySchema, (c, a) => c.account.getOrderHistory(optionalString(a.account), without(a, "account"))),
  tool("account_get_fills", "Read recent or archived fills.", HistorySchema, (c, a) => c.account.getFills(optionalString(a.account), without(a, "account"))),
  tool("account_get_bills", "Read recent or archived account bills.", HistorySchema, (c, a) => c.account.getBills(optionalString(a.account), without(a, "account"))),
  tool("account_get_risk", "Calculate a generic risk summary from current account facts.", AccountOnlySchema, (c, a) => c.account.getRisk(optionalString(a.account))),

  tool("trade_evaluate_plan", "Calculate contract quantity, notional, margin, and stop risk without writing.", EvaluateSchema, (c, a) => c.trade.evaluatePlan(a as never)),
  tool("trade_precheck_order", "Validate an ordinary order against instrument, account, and market facts.", PlaceOrderSchema, (c, a) => c.trade.precheck(a as unknown as PlaceOrderInput)),
  tool("trade_set_leverage", "Set leverage for an OKX instrument and margin mode.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId, lever: z.string().min(1), mgnMode: z.enum(["cross", "isolated"]), posSide: z.string().optional() }), (c, a) => c.trade.setLeverage(a as never)),
  tool("trade_place_order", "Submit an idempotent ordinary OKX order after precheck.", PlaceOrderSchema, (c, a) => c.trade.placeOrder(a as unknown as PlaceOrderInput)),
  tool("trade_place_batch_orders", "Submit up to twenty prechecked ordinary OKX orders idempotently.", z.strictObject({ account: Account, executionKey: ExecutionKey, orders: z.array(BatchOrderItemSchema).min(1).max(20) }), (c, a) => c.trade.placeBatchOrders(a as never)),
  tool("trade_amend_order", "Amend an existing ordinary order idempotently.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId, ordId: z.string().optional(), clOrdId: z.string().optional(), newSize: z.string().optional(), newPrice: z.string().optional() }), (c, a) => c.trade.amendOrder(a as never)),
  tool("trade_cancel_order", "Cancel an existing ordinary order idempotently.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId, ordId: z.string().optional(), clOrdId: z.string().optional() }), (c, a) => c.trade.cancelOrder(a as never)),
  tool("trade_precheck_algo_order", "Validate an algo order against instrument, account, and market facts.", PlaceAlgoSchema, (c, a) => c.trade.precheckAlgo(a as unknown as PlaceAlgoOrderInput)),
  tool("trade_place_algo_order", "Submit an idempotent prechecked trigger, conditional, or trailing order.", PlaceAlgoSchema, (c, a) => c.trade.placeAlgoOrder(a as unknown as PlaceAlgoOrderInput)),
  tool("trade_amend_algo_order", "Amend a supported pending algo order idempotently.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId, algoId: z.string().optional(), algoClOrdId: z.string().optional(), newSize: z.string().optional(), newTriggerPrice: z.string().optional(), newOrderPrice: z.string().optional() }), (c, a) => c.trade.amendAlgoOrder(a as never)),
  tool("trade_cancel_algo_order", "Cancel a pending algo order idempotently.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId, algoId: z.string().min(1) }), (c, a) => c.trade.cancelAlgoOrder(a as never)),
  tool("trade_close_position", "Close an OKX position with a market order idempotently.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId, mgnMode: z.enum(["cross", "isolated"]), posSide: z.string().optional(), ccy: z.string().optional(), autoCancel: z.boolean().optional() }), (c, a) => c.trade.closePosition(a as never)),
  tool("trade_cancel_instrument_orders", "Cancel every pending ordinary and algo order for one instrument.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId }), (c, a) => c.trade.cancelInstrumentOrders(a as never)),
  tool("trade_close_instrument_positions", "Close every open position side for one instrument.", z.strictObject({ account: Account, executionKey: ExecutionKey, instId: InstId }), (c, a) => c.trade.closeInstrumentPositions(a as never))
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}

function derivativeTools(): ToolDefinition[] {
  const operations: Array<[string, string, (service: DerivativesService, query: DerivativesQuery) => Promise<unknown>]> = [
    ["derivatives_get_positioning", "Read open-interest positioning history.", (service, query) => service.positioning(query)],
    ["derivatives_get_taker_flow", "Read contract taker buy and sell flow.", (service, query) => service.takerFlow(query)],
    ["derivatives_get_funding_basis", "Read funding, premium, mark, index, and basis facts.", (service, query) => service.fundingBasis(query)],
    ["derivatives_get_liquidations", "Read recent filled liquidation records.", (service, query) => service.liquidations(query)],
    ["derivatives_get_system_stress", "Read insurance fund, price limits, and position tiers.", (service, query) => service.systemStress(query)],
    ["derivatives_get_position_changes", "Calculate changes between open-interest observations.", (service, query) => service.positionChanges(query)],
    ["derivatives_get_crowding", "Compare market and top-trader long-short ratios.", (service, query) => service.crowding(query)],
    ["derivatives_get_consensus", "Compare positioning, taker flow, and crowding evidence.", (service, query) => service.consensus(query)],
    ["derivatives_get_decision_snapshot", "Read a combined derivatives decision snapshot.", (service, query) => service.decisionSnapshot(query)]
  ];
  return operations.map(([name, description, execute]) => tool(name, description, DerivativesSchema, (context, input) => execute(context.derivatives, input as unknown as DerivativesQuery)));
}

function newsTools(): ToolDefinition[] {
  return [
    experimentalTool("news_list", "List recent OKX news intelligence.", IntelligenceSchema, (c, a) => c.intelligence.newsList(a)),
    experimentalTool("news_search", "Search OKX news intelligence by keyword and filters.", IntelligenceSchema, (c, a) => c.intelligence.newsList(a)),
    experimentalTool("news_read_detail", "Read one news item in detail.", IntelligenceSchema, (c, a) => c.intelligence.newsDetail(a)),
    experimentalTool("news_list_sources", "List available OKX news sources.", IntelligenceSchema, (c, a) => c.intelligence.newsSources(a)),
    experimentalTool("news_read_coin_sentiment", "Read current sentiment for one or more coins.", IntelligenceSchema, (c, a) => c.intelligence.sentiment(a)),
    experimentalTool("news_read_coin_sentiment_trend", "Read sentiment history for one or more coins.", IntelligenceSchema, (c, a) => c.intelligence.sentiment(a, true)),
    experimentalTool("news_read_sentiment_ranking", "Read coin sentiment rankings.", IntelligenceSchema, (c, a) => c.intelligence.sentimentRanking(a)),
    experimentalTool("news_read_economic_calendar", "Read the economic event calendar.", IntelligenceSchema, (c, a) => c.intelligence.economicCalendar(a)),
    experimentalTool("news_list_events", "List locally clustered news events.", IntelligenceSchema, async (c, a) => c.intelligence.listEvents(a)),
    experimentalTool("news_read_event", "Read one locally clustered news event.", IntelligenceSchema, async (c, a) => c.intelligence.readEvent(a)),
    experimentalTool("news_read_market_reaction", "Measure market movement around a news event.", IntelligenceSchema, (c, a) => c.intelligence.marketReaction(a)),
    experimentalTool("news_list_anomalies", "List material derivatives changes near current news.", IntelligenceSchema, (c, a) => c.intelligence.anomalies(a)),
    experimentalTool("news_read_daily_briefing", "Build a daily briefing from news, sentiment, and derivatives.", IntelligenceSchema, (c, a) => c.intelligence.dailyBriefing(a))
  ];
}

function smartTools(): ToolDefinition[] {
  const operations: Array<[string, SmartOperation, string]> = [
    ["smart_money_list_traders", "list_traders", "List Smart Money traders by performance filters."],
    ["smart_money_search_trader", "search_trader", "Search for a Smart Money trader."],
    ["smart_money_read_performance", "read_performance", "Read performance for selected traders."],
    ["smart_money_read_positions", "read_positions", "Read a trader's current positions."],
    ["smart_money_read_position_history", "read_position_history", "Read a trader's closed-position history."],
    ["smart_money_read_order_history", "read_order_history", "Read a trader's public order history."],
    ["smart_money_read_signal_overview_by_filter", "read_signal_overview_by_filter", "Read aggregate Smart Money signals by filters."],
    ["smart_money_read_signal_overview_by_trader", "read_signal_overview_by_trader", "Read aggregate Smart Money signals by trader."],
    ["smart_money_read_signal_trend_by_filter", "read_signal_trend_by_filter", "Read Smart Money signal history by filters."],
    ["smart_money_read_signal_trend_by_trader", "read_signal_trend_by_trader", "Read Smart Money signal history by trader."]
  ];
  return operations.map(([name, operation, description]) => experimentalTool(name, description, SmartSchema, (context, input) => context.intelligence.smart(operation, input)));
}

function tool(name: string, description: string, schema: z.ZodObject, execute: ToolDefinition["execute"]): ToolDefinition {
  return { name, description, schema, execute };
}

function experimentalTool(name: string, description: string, schema: z.ZodObject, execute: ToolDefinition["execute"]): ToolDefinition {
  return tool(name, `Experimental OKX intelligence capability. Remote data requires a configured live OKX account; read-only permission is sufficient. ${description}`, schema, execute);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
