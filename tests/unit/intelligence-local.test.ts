import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/schema.js";
import { IntelligenceService } from "../../src/intelligence/service.js";
import { RuntimeDatabase } from "../../src/storage/database.js";
import type { OkxClient } from "../../src/core/okx-client.js";
import type { AccountService } from "../../src/account/service.js";
import type { MarketService } from "../../src/market/service.js";
import type { DerivativesService } from "../../src/derivatives/service.js";

const databases: RuntimeDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("local intelligence", () => {
  it("clusters persisted news and returns Smart Money history without network access", async () => {
    const database = new RuntimeDatabase(":memory:");
    databases.push(database);
    const items = JSON.parse(fs.readFileSync(new URL("../fixtures/news-items.json", import.meta.url), "utf8")) as Array<Record<string, unknown>>;
    for (const item of items) database.upsertIntelligence("news", String(item.id), Number(item.publishTime), item);
    database.upsertIntelligence("smart:list_traders", "trader-1", Date.now(), { authorId: "trader-1", pnl: "100" });
    await new Promise((resolve) => setImmediate(resolve));
    const service = new IntelligenceService(
      structuredClone(DEFAULT_CONFIG),
      {} as OkxClient,
      {} as AccountService,
      database,
      {} as MarketService,
      {} as DerivativesService
    );
    const events = service.listEvents({ since: 1785390000000 });
    expect(events.data).toHaveLength(1);
    expect((events.data[0] as Record<string, unknown>).sourceCount).toBe(2);
    const smart = await service.smart("list_traders", { localOnly: true });
    expect(smart.data).toEqual([{ authorId: "trader-1", pnl: "100" }]);
  });
});
