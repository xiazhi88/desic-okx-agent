import fs from "node:fs";
import { AccountService } from "../account/service.js";
import { loadConfig } from "../config/loader.js";
import { CONFIG_PATH } from "../config/paths.js";
import { OkxClient } from "../core/okx-client.js";
import { PACKAGE_VERSION } from "../core/version.js";
import { checkOkxConnectivity, OKX_REST_BASE_URL } from "../network/connectivity.js";
import { displayProxy, resolveProxy } from "../network/proxy.js";
import { RuntimeClient } from "../runtime/client.js";
import { inspectSetupTargets, syncSkills } from "../setup/installer.js";
import { checkForUpdate } from "../update/service.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  details: string;
}

export interface DoctorReport {
  ok: boolean;
  version: string;
  checkedAt: number;
  checks: DoctorCheck[];
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
    const permission = configPermission();
    checks.push({ name: "Configuration", status: permission.secure ? "pass" : "warn", details: permission.details });
  } catch (error) {
    checks.push({ name: "Configuration", status: "fail", details: errorMessage(error) });
    return report(checks);
  }

  try {
    const update = await checkForUpdate(undefined, config.proxy.url);
    checks.push({
      name: "Package",
      status: update.updateAvailable ? "warn" : "pass",
      details: update.updateAvailable ? `${update.current} installed; ${update.latest} available` : `${update.current} is current`
    });
  } catch (error) {
    checks.push({ name: "Package", status: "warn", details: `Could not check npm: ${errorMessage(error)}` });
  }

  const clients = inspectSetupTargets();
  const configured = clients.filter((item) => item.mcpConfigured === true);
  checks.push({
    name: "MCP clients",
    status: configured.length ? "pass" : "warn",
    details: configured.length ? configured.map((item) => item.target).join(", ") : "No supported client configuration was detected"
  });

  const installedSkillTargets = clients.filter((item) => item.skillsInstalled !== null && item.skillsInstalled > 0)
    .map((item) => item.target).filter((target): target is "codex" | "claude-code" => target === "codex" || target === "claude-code");
  if (installedSkillTargets.length) {
    const skills = syncSkills(installedSkillTargets, { dryRun: true });
    const pending = skills.reduce((total, item) => total + item.installed + item.updated, 0);
    checks.push({
      name: "Skills",
      status: pending ? "warn" : "pass",
      details: pending ? `${pending} bundled Skills need synchronization` : `${skills.reduce((sum, item) => sum + item.unchanged, 0)} bundled Skills are current`
    });
  } else {
    checks.push({ name: "Skills", status: "warn", details: "No Codex or Claude Code Skills were detected" });
  }

  const proxy = resolveProxy(config.proxy.url);
  const network = await checkOkxConnectivity(proxy.url);
  checks.push({
    name: "OKX network",
    status: network.ok ? "pass" : "fail",
    details: network.ok
      ? `${displayProxy(proxy)}; REST ${network.rest.latencyMs}ms, WebSocket ${network.websocket.latencyMs}ms`
      : `${displayProxy(proxy)}; REST ${network.rest.error ?? "failed"}; WebSocket ${network.websocket.error ?? "failed"}`
  });

  if (network.ok) {
    try {
      const runtime = await RuntimeClient.connect();
      const health = await runtime.health();
      const diagnostics = await runtime.diagnostics();
      checks.push({ name: "Runtime", status: health.version === PACKAGE_VERSION ? "pass" : "warn", details: `version ${String(health.version)}, PID ${String(health.pid)}, uptime ${formatDuration(Number(health.uptimeMs))}` });
      const integrity = String((diagnostics.database as Record<string, unknown> | undefined)?.integrity ?? "unknown");
      checks.push({ name: "SQLite", status: integrity === "ok" ? "pass" : "fail", details: `integrity ${integrity}` });
      const ticker = await runtime.call("market_get_ticker", { instId: "BTC-USDT-SWAP" }) as { data?: Record<string, unknown>; meta?: Record<string, unknown> };
      checks.push({ name: "Market data", status: "pass", details: `BTC-USDT-SWAP last ${String(ticker.data?.last ?? "received")}, age ${String(ticker.meta?.ageMs ?? "unknown")}ms` });
    } catch (error) {
      checks.push({ name: "Runtime", status: "fail", details: errorMessage(error) });
    }
  }

  const accounts = Object.keys(config.accounts);
  if (!accounts.length) {
    checks.push({ name: "Accounts", status: "warn", details: "No account configured; public market tools remain available" });
  } else if (network.ok) {
    const client = new OkxClient(OKX_REST_BASE_URL, proxy.url);
    const service = new AccountService(config, client);
    for (const name of accounts) {
      try {
        const verified = await service.verify(name);
        checks.push({ name: `Account ${name}`, status: "pass", details: `${config.accounts[name]?.environment}; permissions ${String(verified.data.perm ?? "reported by OKX")}` });
      } catch (error) {
        checks.push({ name: `Account ${name}`, status: "fail", details: errorMessage(error) });
      }
    }
  }
  return report(checks);
}

export function formatDoctor(reportValue: DoctorReport): string {
  const width = Math.max(...reportValue.checks.map((check) => check.name.length), 6);
  const lines = ["Desic OKX Doctor", ""];
  for (const check of reportValue.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(4)}  ${check.name.padEnd(width)}  ${check.details}`);
  }
  lines.push("", reportValue.ok ? "Ready" : "Action required");
  return lines.join("\n");
}

function configPermission(): { secure: boolean; details: string } {
  if (!fs.existsSync(CONFIG_PATH)) return { secure: true, details: "defaults in use; no config file created" };
  if (process.platform === "win32") return { secure: true, details: CONFIG_PATH };
  const mode = fs.statSync(CONFIG_PATH).mode & 0o777;
  return mode & 0o077
    ? { secure: false, details: `${CONFIG_PATH}; permissions should be 0600` }
    : { secure: true, details: `${CONFIG_PATH}; permissions 0600` };
}

function report(checks: DoctorCheck[]): DoctorReport {
  return { ok: checks.every((check) => check.status !== "fail"), version: PACKAGE_VERSION, checkedAt: Date.now(), checks };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
