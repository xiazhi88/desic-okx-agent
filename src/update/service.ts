import { spawn } from "node:child_process";
import { ProxyAgent } from "undici";
import { PACKAGE_VERSION } from "../core/version.js";
import { resolveProxy } from "../network/proxy.js";
import { RuntimeClient } from "../runtime/client.js";
import { isProcessRunning, readRuntimeState } from "../runtime/state.js";

export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  registry: string;
}

export async function checkForUpdate(registry = OFFICIAL_NPM_REGISTRY, configuredProxy?: string): Promise<UpdateInfo> {
  const proxy = resolveProxy(configuredProxy);
  const dispatcher = proxy.url ? new ProxyAgent(proxy.url) : undefined;
  try {
    const base = registry.replace(/\/$/, "");
    const response = await fetch(`${base}/desic-okx-agent/latest`, {
      signal: AbortSignal.timeout(10_000),
      ...(dispatcher ? { dispatcher } : {})
    } as RequestInit & { dispatcher?: ProxyAgent });
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
    const data = await response.json() as { version?: string };
    if (!data.version) throw new Error("npm registry did not return a package version");
    return {
      current: PACKAGE_VERSION,
      latest: data.version,
      updateAvailable: compareVersions(data.version, PACKAGE_VERSION) > 0,
      registry: base
    };
  } finally {
    await dispatcher?.close();
  }
}

export async function installLatestVersion(info: UpdateInfo): Promise<number> {
  await stopRuntimeForUpdate();
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["install", "--global", `desic-okx-agent@${info.latest}`, `--registry=${info.registry}`];
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: false,
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function runInstalledCommand(args: string[]): Promise<number> {
  const command = process.platform === "win32" ? "desic-okx.cmd" : "desic-okx";
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: false,
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function stopRuntimeForUpdate(): Promise<void> {
  const state = readRuntimeState();
  if (!state) return;
  let pid = state.pid;
  let stopRequested = false;
  try {
    const client = await RuntimeClient.connect({ start: false });
    const health = await client.health();
    pid = Number(health.pid);
    await client.stop();
    stopRequested = true;
  } catch (error) {
    if (isProcessRunning(pid)) throw new Error(`Runtime PID ${pid} is running but could not be contacted safely: ${error instanceof Error ? error.message : "unknown error"}`);
    return;
  }
  await waitForProcess(pid, 5_000);
  if (stopRequested && isProcessRunning(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    await waitForProcess(pid, 2_000);
  }
  if (isProcessRunning(pid)) throw new Error(`Runtime PID ${pid} did not stop`);
}

async function waitForProcess(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Number.isInteger(pid) && isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
  }
  return 0;
}
