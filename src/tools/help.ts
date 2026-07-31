import { z } from "zod";
import { toolByName } from "./catalog.js";

export type AccountRequirement = "none" | "live-read-only" | "account-read" | "account-trade";

export interface ToolHelp {
  name: string;
  description: string;
  accountRequirement: AccountRequirement;
  inputSchema: unknown;
  example: Record<string, unknown>;
}

export function getToolHelp(name: string): ToolHelp | undefined {
  const definition = toolByName(name);
  if (!definition) return undefined;
  return {
    name: definition.name,
    description: definition.description,
    accountRequirement: accountRequirement(name),
    inputSchema: z.toJSONSchema(definition.schema),
    example: toolExample(name)
  };
}

export function toolExample(name: string): Record<string, unknown> {
  const exact = EXAMPLES[name];
  if (exact) return structuredClone(exact);
  if (name.startsWith("market_")) return { instId: "BTC-USDT-SWAP" };
  if (name.startsWith("derivatives_")) return { instId: "BTC-USDT-SWAP", period: "5m", limit: 50 };
  if (name.startsWith("news_")) return { account: "default", limit: 20 };
  if (name.startsWith("smart_money_")) return { account: "default", period: "7", limit: 20 };
  if (name.startsWith("account_")) return { account: "default" };
  return {};
}

function accountRequirement(name: string): AccountRequirement {
  if (name.startsWith("news_") || name.startsWith("smart_money_")) return "live-read-only";
  if (name.startsWith("account_") || name.startsWith("trade_precheck_")) return "account-read";
  if (name.startsWith("trade_") && name !== "trade_evaluate_plan") return "account-trade";
  return "none";
}

const EXAMPLES: Record<string, Record<string, unknown>> = {
  market_get_candles: { instId: "BTC-USDT-SWAP", bar: "5m", limit: 100 },
  market_get_indicators: { instId: "BTC-USDT-SWAP", bar: "5m", limit: 200 },
  market_get_decision_snapshot: { instId: "BTC-USDT-SWAP", bar: "1m", limit: 100 },
  market_scan_watchlist: { instIds: ["BTC-USDT-SWAP", "ETH-USDT-SWAP"], bar: "5m" },
  news_search: { account: "default", keyword: "Bitcoin ETF", coins: ["BTC"], limit: 20 },
  news_read_detail: { account: "default", id: "NEWS_ITEM_ID" },
  news_read_coin_sentiment: { account: "default", coins: ["BTC", "ETH"], period: "24h" },
  news_read_coin_sentiment_trend: { account: "default", coins: ["BTC"], period: "1h", limit: 24 },
  news_read_market_reaction: { id: "LOCAL_EVENT_ID", instId: "BTC-USDT-SWAP", bar: "5m", limit: 100 },
  smart_money_search_trader: { account: "default", keyword: "TRADER_NAME" },
  smart_money_read_positions: { account: "default", authorId: "TRADER_ID" },
  account_get_positions: { account: "default", instId: "BTC-USDT-SWAP" },
  account_get_order: { account: "default", instId: "BTC-USDT-SWAP", ordId: "ORDER_ID" },
  account_get_order_history: { account: "default", instType: "SWAP", limit: 50 },
  trade_evaluate_plan: { instId: "BTC-USDT-SWAP", side: "buy", size: "1", leverage: "3", stopLossPrice: "90000" },
  trade_precheck_order: ordinaryOrder("precheck-btc-001"),
  trade_place_order: ordinaryOrder("place-btc-001"),
  trade_place_batch_orders: {
    account: "default", executionKey: "batch-btc-001",
    orders: [{ instId: "BTC-USDT-SWAP", tdMode: "cross", side: "buy", ordType: "limit", size: "1", price: "90000" }]
  },
  trade_set_leverage: { account: "default", executionKey: "leverage-btc-001", instId: "BTC-USDT-SWAP", lever: "3", mgnMode: "cross" },
  trade_amend_order: { account: "default", executionKey: "amend-btc-001", instId: "BTC-USDT-SWAP", ordId: "ORDER_ID", newPrice: "90500" },
  trade_cancel_order: { account: "default", executionKey: "cancel-btc-001", instId: "BTC-USDT-SWAP", ordId: "ORDER_ID" },
  trade_precheck_algo_order: algoOrder("precheck-algo-btc-001"),
  trade_place_algo_order: algoOrder("place-algo-btc-001"),
  trade_amend_algo_order: { account: "default", executionKey: "amend-algo-btc-001", instId: "BTC-USDT-SWAP", algoId: "ALGO_ID", newTriggerPrice: "88000" },
  trade_cancel_algo_order: { account: "default", executionKey: "cancel-algo-btc-001", instId: "BTC-USDT-SWAP", algoId: "ALGO_ID" },
  trade_close_position: { account: "default", executionKey: "close-btc-001", instId: "BTC-USDT-SWAP", mgnMode: "cross", posSide: "net" },
  trade_cancel_instrument_orders: { account: "default", executionKey: "cancel-all-btc-001", instId: "BTC-USDT-SWAP" },
  trade_close_instrument_positions: { account: "default", executionKey: "close-all-btc-001", instId: "BTC-USDT-SWAP" }
};

function ordinaryOrder(executionKey: string): Record<string, unknown> {
  return { account: "default", executionKey, instId: "BTC-USDT-SWAP", tdMode: "cross", side: "buy", ordType: "limit", size: "1", price: "90000" };
}

function algoOrder(executionKey: string): Record<string, unknown> {
  return { account: "default", executionKey, instId: "BTC-USDT-SWAP", tdMode: "cross", side: "sell", ordType: "trigger", size: "1", triggerPrice: "88000", orderPrice: "-1", reduceOnly: true };
}
