import fs from "node:fs";
import path from "node:path";
import type { AccountCredentials } from "../core/types.js";
import { RuntimeError } from "../core/errors.js";
import { CONFIG_PATH } from "./paths.js";
import { DEFAULT_CONFIG, RuntimeConfigSchema, type RuntimeConfig, type StoredAccount } from "./schema.js";

export function loadConfig(configPath = CONFIG_PATH): RuntimeConfig {
  let raw: unknown = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      throw new RuntimeError("VALIDATION", `Cannot read config: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }
  const parsed = RuntimeConfigSchema.parse(raw);
  return applyEnvironment(parsed, process.env);
}

export function loadStoredConfig(configPath = CONFIG_PATH): RuntimeConfig {
  if (!fs.existsSync(configPath)) return structuredClone(DEFAULT_CONFIG);
  return RuntimeConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

export function applyEnvironment(config: RuntimeConfig, env: NodeJS.ProcessEnv): RuntimeConfig {
  const fields = [env.OKX_API_KEY, env.OKX_API_SECRET, env.OKX_API_PASSPHRASE];
  const supplied = fields.filter((value) => Boolean(value?.trim())).length;
  if (supplied > 0 && supplied < 3) {
    throw new RuntimeError("VALIDATION", "OKX_API_KEY, OKX_API_SECRET, and OKX_API_PASSPHRASE must be provided together");
  }
  if (supplied === 0) return config;
  const name = env.OKX_ACCOUNT?.trim() || "default";
  const environment = env.OKX_ENVIRONMENT === "demo" ? "demo" : "live";
  return RuntimeConfigSchema.parse({
    ...config,
    defaultAccount: name,
    accounts: {
      ...config.accounts,
      [name]: {
        environment,
        apiKey: env.OKX_API_KEY,
        secretKey: env.OKX_API_SECRET,
        passphrase: env.OKX_API_PASSPHRASE
      }
    }
  });
}

export function saveConfig(config: RuntimeConfig, configPath = CONFIG_PATH): void {
  const normalized = RuntimeConfigSchema.parse(config);
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, configPath);
  fs.chmodSync(configPath, 0o600);
}

export function resolveAccount(config: RuntimeConfig, requested?: string): AccountCredentials {
  const name = requested?.trim() || config.defaultAccount;
  if (!name) throw new RuntimeError("AUTH", "No OKX account is configured");
  const account = config.accounts[name];
  if (!account) throw new RuntimeError("NOT_FOUND", `OKX account '${name}' was not found`);
  return { name, ...account };
}

export function toStoredAccount(account: AccountCredentials): StoredAccount {
  return {
    environment: account.environment,
    apiKey: account.apiKey,
    secretKey: account.secretKey,
    passphrase: account.passphrase
  };
}

export function accountSummaries(config: RuntimeConfig): Array<Record<string, unknown>> {
  return Object.entries(config.accounts).map(([name, account]) => ({
    name,
    environment: account.environment,
    default: config.defaultAccount === name,
    apiKey: mask(account.apiKey)
  }));
}

function mask(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
