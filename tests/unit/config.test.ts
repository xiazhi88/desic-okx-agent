import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyEnvironment, loadStoredConfig, saveConfig } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/schema.js";
import { DATA_DIR, RUNTIME_DIR } from "../../src/config/paths.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe("configuration", () => {
  it("keeps singleton state in the stable application data directory", () => {
    expect(RUNTIME_DIR.startsWith(DATA_DIR)).toBe(true);
  });
  it("requires a complete environment credential triplet", () => {
    expect(() => applyEnvironment(structuredClone(DEFAULT_CONFIG), { OKX_API_KEY: "only-one" })).toThrow("must be provided together");
  });

  it("overrides a named config account from environment", () => {
    const config = applyEnvironment(structuredClone(DEFAULT_CONFIG), {
      OKX_ACCOUNT: "main",
      OKX_API_KEY: "key",
      OKX_API_SECRET: "secret",
      OKX_API_PASSPHRASE: "pass",
      OKX_ENVIRONMENT: "live"
    });
    expect(config.defaultAccount).toBe("main");
    expect(config.accounts.main?.environment).toBe("live");
  });

  it("writes credentials atomically with private Unix permissions", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "okx-config-"));
    directories.push(directory);
    const file = path.join(directory, "config.json");
    const config = structuredClone(DEFAULT_CONFIG);
    config.defaultAccount = "demo";
    config.accounts.demo = { environment: "demo", apiKey: "key", secretKey: "secret", passphrase: "pass" };
    saveConfig(config, file);
    expect(loadStoredConfig(file).accounts.demo?.secretKey).toBe("secret");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o077).toBe(0);
  });
});
