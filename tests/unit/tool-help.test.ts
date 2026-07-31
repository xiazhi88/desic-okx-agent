import { describe, expect, it } from "vitest";
import { getToolHelp } from "../../src/tools/help.js";

describe("tool help", () => {
  it("describes public tools with runnable examples", () => {
    const help = getToolHelp("market_get_decision_snapshot");
    expect(help?.accountRequirement).toBe("none");
    expect(help?.example).toMatchObject({ instId: "BTC-USDT-SWAP", bar: "1m" });
    expect(help?.inputSchema).toBeDefined();
  });

  it("marks News remote data as requiring a live read-only account", () => {
    const help = getToolHelp("news_search");
    expect(help?.accountRequirement).toBe("live-read-only");
    expect(help?.description).toContain("requires a configured live OKX account");
  });

  it("returns undefined for unknown tools", () => {
    expect(getToolHelp("missing_tool")).toBeUndefined();
  });
});
