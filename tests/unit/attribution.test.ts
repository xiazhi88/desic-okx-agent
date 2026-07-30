import { describe, expect, it, vi, afterEach } from "vitest";
import { applyOrderAttribution } from "../../src/core/attribution.js";
import { OkxClient } from "../../src/core/okx-client.js";
import { sanitizeValue } from "../../src/core/sanitize.js";
import type { AccountCredentials } from "../../src/core/types.js";

const account: AccountCredentials = {
  name: "test",
  environment: "demo",
  apiKey: "api-key-value",
  secretKey: "secret-key-value",
  passphrase: "passphrase-value"
};

afterEach(() => vi.unstubAllGlobals());

describe("order attribution boundary", () => {
  it("adds attribution only to supported creation requests", () => {
    let marker: unknown;
    for (const path of ["/api/v5/trade/order", "/api/v5/trade/order-algo", "/api/v5/trade/close-position"]) {
      const value = applyOrderAttribution(path, { instId: "BTC-USDT-SWAP" }) as Record<string, unknown>;
      marker ??= value.tag;
      expect(value.tag).toBe(marker);
    }
    expect(marker).toMatch(/^[a-zA-Z0-9]{16}$/);
    const batch = applyOrderAttribution("/api/v5/trade/batch-orders", [{ instId: "BTC-USDT-SWAP" }]) as Array<Record<string, unknown>>;
    expect(batch[0]?.tag).toBe(marker);
    expect(applyOrderAttribution("/api/v5/trade/cancel-order", { instId: "BTC-USDT-SWAP" })).toEqual({ instId: "BTC-USDT-SWAP" });
  });

  it("rejects a caller supplied field", () => {
    expect(() => applyOrderAttribution("/api/v5/trade/order", { instId: "BTC-USDT-SWAP", tag: "caller" })).toThrow("Unsupported order request field");
  });

  it("injects at transport time and strips private response fields", async () => {
    let sentBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ code: "0", msg: "", data: [{ ordId: "1", tag: "remote" }] }), { status: 200 });
    }));
    const client = new OkxClient("https://example.test");
    const result = await client.privatePost("/api/v5/trade/order", account, { instId: "BTC-USDT-SWAP" }, true);
    const expected = applyOrderAttribution("/api/v5/trade/order", { instId: "BTC-USDT-SWAP" }) as Record<string, unknown>;
    expect(JSON.parse(sentBody).tag).toBe(expected.tag);
    expect(result).toEqual([{ ordId: "1" }]);
  });

  it("redacts credentials and private fields recursively", () => {
    expect(sanitizeValue({ tag: "x", nested: { apiKey: account.apiKey, text: `before-${account.passphrase}-after` } }, [account]))
      .toEqual({ nested: { text: "before-[REDACTED]-after" } });
  });
});
