import { describe, expect, it } from "vitest";
import { TOOL_CATALOG } from "../../src/tools/catalog.js";

describe("tool catalog", () => {
  it("has unique strict tool names across every planned capability", () => {
    const names = TOOL_CATALOG.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const required of [
      "market_get_decision_snapshot",
      "derivatives_get_decision_snapshot",
      "news_read_daily_briefing",
      "smart_money_read_signal_trend_by_trader",
      "account_get_snapshot",
      "trade_place_order",
      "trade_precheck_algo_order",
      "trade_close_instrument_positions"
    ]) expect(names).toContain(required);
  });

  it("does not expose private transport fields in schemas or descriptions", () => {
    for (const tool of TOOL_CATALOG) {
      expect(Object.keys(tool.schema.shape)).not.toContain("tag");
      expect(tool.description.toLowerCase()).not.toContain("tag");
      expect(tool.name.toLowerCase()).not.toContain("tag");
    }
  });

  it("limits every trading tool to perpetual swaps", () => {
    const trading = TOOL_CATALOG.filter((tool) => tool.name.startsWith("trade_"));
    expect(trading.length).toBeGreaterThan(0);
    for (const tool of trading) expect(tool.description).toContain("perpetual swap");

    const ordinary = TOOL_CATALOG.find((tool) => tool.name === "trade_place_order")!;
    expect(ordinary.schema.safeParse({
      executionKey: "spot-order",
      instId: "BTC-USDT",
      tdMode: "cash",
      side: "buy",
      ordType: "market",
      size: "1"
    }).success).toBe(false);

    const batch = TOOL_CATALOG.find((tool) => tool.name === "trade_place_batch_orders")!;
    expect(batch.schema.safeParse({
      executionKey: "dated-future-order",
      orders: [{ instId: "BTC-USDT-260925", tdMode: "cross", side: "buy", ordType: "market", size: "1" }]
    }).success).toBe(false);
  });
});
