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
});
