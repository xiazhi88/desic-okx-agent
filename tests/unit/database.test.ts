import { afterEach, describe, expect, it } from "vitest";
import { RuntimeDatabase } from "../../src/storage/database.js";

const databases: RuntimeDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("RuntimeDatabase", () => {
  it("stores idempotent execution state", () => {
    const database = new RuntimeDatabase(":memory:");
    databases.push(database);
    expect(database.beginExecution("key", "place_order", "hash")).toBeUndefined();
    expect(database.beginExecution("key", "place_order", "hash")?.status).toBe("submitting");
    database.finishExecution("key", "accepted", { ordId: "1" });
    expect(database.getExecution("key")?.response).toEqual({ ordId: "1" });
  });

  it("persists and restores candle rows", async () => {
    const database = new RuntimeDatabase(":memory:");
    databases.push(database);
    database.saveCandles("BTC-USDT-SWAP", "1m", [["1", "1", "1", "1", "1", "1", "1", "1", "1"]]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(database.loadCandles("BTC-USDT-SWAP", "1m", 10)).toHaveLength(1);
  });
});
