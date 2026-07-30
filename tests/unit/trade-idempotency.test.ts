import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeService, type PlaceOrderInput } from "../../src/trade/service.js";
import { RuntimeDatabase } from "../../src/storage/database.js";
import { RuntimeError } from "../../src/core/errors.js";
import type { OkxClient } from "../../src/core/okx-client.js";
import type { AccountService } from "../../src/account/service.js";
import type { MarketService } from "../../src/market/service.js";

const databases: RuntimeDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("trade execution idempotency", () => {
  it("replays an accepted response without submitting twice", async () => {
    const database = new RuntimeDatabase(":memory:");
    databases.push(database);
    const account = { name: "demo", environment: "demo" as const, apiKey: "key", secretKey: "secret", passphrase: "pass" };
    const client = { privatePost: vi.fn(async () => [{ ordId: "1" }]) } as unknown as OkxClient;
    const accounts = { account: vi.fn(() => account) } as unknown as AccountService;
    const service = new TradeService(client, accounts, {} as MarketService, database);
    vi.spyOn(service, "precheck").mockResolvedValue({ data: { ok: true, blockers: [] }, meta: { requestId: "1", environment: "demo", source: "mixed", exchangeTs: null, receivedAt: Date.now(), ageMs: null, warnings: [] } });
    const input: PlaceOrderInput = { executionKey: "stable-key", account: "demo", instId: "BTC-USDT-SWAP", tdMode: "cross", side: "buy", ordType: "limit", size: "1", price: "100" };
    const first = await service.placeOrder(input);
    const second = await service.placeOrder(input);
    expect(first.data.orders).toEqual([{ ordId: "1" }]);
    expect(second.data.replayed).toBe(true);
    expect(client.privatePost).toHaveBeenCalledTimes(1);
  });

  it("reconciles an ambiguous write before returning", async () => {
    const database = new RuntimeDatabase(":memory:");
    databases.push(database);
    const account = { name: "demo", environment: "demo" as const, apiKey: "key", secretKey: "secret", passphrase: "pass" };
    const client = {
      privatePost: vi.fn(async () => { throw new RuntimeError("NETWORK", "timeout", true); }),
      privateGet: vi.fn(async () => [{ ordId: "remote-1", state: "live" }])
    } as unknown as OkxClient;
    const accounts = { account: vi.fn(() => account) } as unknown as AccountService;
    const service = new TradeService(client, accounts, {} as MarketService, database);
    vi.spyOn(service, "precheck").mockResolvedValue({ data: { ok: true, blockers: [] }, meta: { requestId: "1", environment: "demo", source: "mixed", exchangeTs: null, receivedAt: Date.now(), ageMs: null, warnings: [] } });
    const result = await service.placeOrder({ executionKey: "ambiguous-key", account: "demo", instId: "BTC-USDT-SWAP", tdMode: "cross", side: "buy", ordType: "limit", size: "1", price: "100" });
    expect(result.data.reconciled).toBe(true);
    expect(result.data.orders).toEqual([{ ordId: "remote-1", state: "live" }]);
    expect(client.privateGet).toHaveBeenCalledTimes(1);
    expect(database.getExecution("ambiguous-key")?.status).toBe("reconciled");
  });
});
