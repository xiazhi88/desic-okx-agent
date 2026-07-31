import { describe, expect, it, vi } from "vitest";
import { detectAccountEnvironment } from "../../src/account/service.js";
import { RuntimeError } from "../../src/core/errors.js";
import type { AccountCredentials } from "../../src/core/types.js";

const credentials = { name: "main", apiKey: "key", secretKey: "secret", passphrase: "pass" };

describe("OKX account environment detection", () => {
  it("accepts a live account without probing Demo Trading", async () => {
    const privateGet = vi.fn(async (_path: string, account: AccountCredentials) => {
      if (account.environment !== "live") throw new RuntimeError("AUTH", "wrong environment");
      return [{ perm: "read_only" }];
    });

    const detected = await detectAccountEnvironment({ privateGet } as never, credentials);

    expect(detected.account.environment).toBe("live");
    expect(detected.config).toEqual({ perm: "read_only" });
    expect(privateGet).toHaveBeenCalledTimes(1);
  });

  it("falls back to the simulated-trading request mode for a Demo account", async () => {
    const environments: string[] = [];
    const privateGet = vi.fn(async (_path: string, account: AccountCredentials) => {
      environments.push(account.environment);
      if (account.environment === "live") throw new RuntimeError("AUTH", "wrong environment");
      return [{ perm: "read_write" }];
    });

    const detected = await detectAccountEnvironment({ privateGet } as never, credentials);

    expect(detected.account.environment).toBe("demo");
    expect(environments).toEqual(["live", "demo"]);
  });

  it("does not retry another environment for a network failure", async () => {
    const privateGet = vi.fn(async () => {
      throw new RuntimeError("NETWORK", "offline", true);
    });

    await expect(detectAccountEnvironment({ privateGet } as never, credentials)).rejects.toMatchObject({ code: "NETWORK" });
    expect(privateGet).toHaveBeenCalledTimes(1);
  });
});
