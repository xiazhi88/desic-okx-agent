import { spawnSync } from "node:child_process";

export type ProxySource = "config" | "environment" | "system" | "none";

export interface ResolvedProxy {
  url?: string;
  source: ProxySource;
}

interface CommandResult {
  status: number | null;
  stdout: string;
}

interface ProxyResolutionOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: string[]) => CommandResult;
}

const OKX_HOST = "openapi.okx.com";

export function resolveProxy(configuredUrl?: string, options: ProxyResolutionOptions = {}): ResolvedProxy {
  if (configuredUrl?.trim()) return { url: normalizeProxyUrl(configuredUrl), source: "config" };

  const env = options.env ?? process.env;
  const environmentUrl = environmentProxy(env);
  if (environmentUrl && !matchesNoProxy(OKX_HOST, env.NO_PROXY ?? env.no_proxy)) {
    const normalized = tryNormalizeProxyUrl(environmentUrl);
    if (normalized) return { url: normalized, source: "environment" };
  }

  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? runSystemCommand;
  const systemUrl = platform === "win32"
    ? windowsSystemProxy(runCommand)
    : platform === "darwin"
      ? macSystemProxy(runCommand)
      : undefined;
  const normalizedSystemUrl = systemUrl ? tryNormalizeProxyUrl(systemUrl) : undefined;
  return normalizedSystemUrl ? { url: normalizedSystemUrl, source: "system" } : { source: "none" };
}

export function normalizeProxyUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("Proxy URL is required");
  const url = new URL(candidate.includes("://") ? candidate : `http://${candidate}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Proxy URL must use http:// or https://");
  }
  if (!url.hostname) throw new Error("Proxy URL must include a host");
  return url.toString().replace(/\/$/, "");
}

export function displayProxy(proxy: ResolvedProxy): string {
  if (!proxy.url) return "direct connection";
  const url = new URL(proxy.url);
  if (url.username) url.username = "***";
  if (url.password) url.password = "***";
  return `${url.toString().replace(/\/$/, "")} (${proxy.source})`;
}

function environmentProxy(env: NodeJS.ProcessEnv): string | undefined {
  return firstValue(env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy);
}

function windowsSystemProxy(runCommand: (command: string, args: string[]) => CommandResult): string | undefined {
  const result = runCommand("reg.exe", [
    "query",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
  ]);
  if (result.status !== 0) return undefined;
  const values = parseRegistryValues(result.stdout);
  if (!isEnabled(values.ProxyEnable)) return undefined;
  return selectWindowsProxy(values.ProxyServer);
}

function macSystemProxy(runCommand: (command: string, args: string[]) => CommandResult): string | undefined {
  const result = runCommand("/usr/sbin/scutil", ["--proxy"]);
  if (result.status !== 0) return undefined;
  const values = parseScutilValues(result.stdout);
  if (values.HTTPSEnable === "1" && values.HTTPSProxy && values.HTTPSPort) {
    return `http://${values.HTTPSProxy}:${values.HTTPSPort}`;
  }
  if (values.HTTPEnable === "1" && values.HTTPProxy && values.HTTPPort) {
    return `http://${values.HTTPProxy}:${values.HTTPPort}`;
  }
  return undefined;
}

function selectWindowsProxy(value?: string): string | undefined {
  if (!value) return undefined;
  if (!value.includes("=")) return value;
  const entries = Object.fromEntries(value.split(";").map((item) => item.split("=", 2).map((part) => part.trim())));
  return firstValue(entries.https, entries.http);
}

function parseRegistryValues(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s+([^\s]+)\s+REG_[^\s]+\s+(.+)$/);
    if (match?.[1] && match[2]) values[match[1]] = match[2].trim();
  }
  return values;
}

function parseScutilValues(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([^\s:]+)\s*:\s*(.+)$/);
    if (match?.[1] && match[2]) values[match[1]] = match[2].trim();
  }
  return values;
}

function isEnabled(value?: string): boolean {
  if (!value) return false;
  const numeric = value.toLowerCase().startsWith("0x") ? Number.parseInt(value.slice(2), 16) : Number(value);
  return numeric === 1;
}

function matchesNoProxy(host: string, value?: string): boolean {
  if (!value?.trim()) return false;
  return value.split(",").some((rawEntry) => {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) return false;
    if (entry === "*") return true;
    const withoutPort = entry.replace(/:\d+$/, "");
    const suffix = withoutPort.startsWith("*.") ? withoutPort.slice(1) : withoutPort;
    return host === suffix.replace(/^\./, "") || host.endsWith(suffix.startsWith(".") ? suffix : `.${suffix}`);
  });
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function tryNormalizeProxyUrl(value: string): string | undefined {
  try {
    return normalizeProxyUrl(value);
  } catch {
    return undefined;
  }
}

function runSystemCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout ?? "" };
}
