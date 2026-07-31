import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "../core/errors.js";
import { PACKAGE_VERSION } from "../core/version.js";
import { RUNTIME_LOCK_PATH, RUNTIME_STATE_PATH } from "../config/paths.js";
import { isProcessRunning, readRuntimeState, type RuntimeState } from "./state.js";

export class RuntimeClient {
  private constructor(private readonly state: RuntimeState) {}

  static async connect(options: { start?: boolean } = { start: true }): Promise<RuntimeClient> {
    let state = readRuntimeState();
    if (state && await healthy(state)) {
      if (options.start !== false && state.version !== PACKAGE_VERSION) {
        const stopAccepted = await stopRuntime(state);
        if (!stopAccepted) throw new RuntimeError("INTERNAL", `Older Runtime PID ${state.pid} could not be contacted safely`);
        await waitUntilStopped(state.pid, 5_000);
        if (isProcessRunning(state.pid)) {
          try { process.kill(state.pid, "SIGTERM"); } catch {}
          await waitUntilStopped(state.pid, 2_000);
        }
        if (isProcessRunning(state.pid)) {
          throw new RuntimeError("INTERNAL", `Older Runtime PID ${state.pid} could not be stopped`);
        }
        clearDeadRuntimeFiles(state);
        state = undefined;
      } else {
        return new RuntimeClient(state);
      }
    }
    clearDeadRuntimeFiles(state);
    if (options.start === false) throw new RuntimeError("NOT_FOUND", "OKX runtime is not running");
    startDetachedRuntime();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await delay(100);
      state = readRuntimeState();
      if (state && await healthy(state)) return new RuntimeClient(state);
    }
    throw new RuntimeError("NETWORK", "OKX runtime did not become ready within 15 seconds");
  }

  async health(): Promise<Record<string, unknown>> {
    return this.request("GET", "/health") as Promise<Record<string, unknown>>;
  }

  async tools(): Promise<Array<{ name: string; description: string }>> {
    const response = await this.request("GET", "/v1/tools") as { tools: Array<{ name: string; description: string }> };
    return response.tools;
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    return this.request("GET", "/diagnostics") as Promise<Record<string, unknown>>;
  }

  async call(name: string, input: unknown = {}): Promise<unknown> {
    const response = await this.request("POST", "/v1/call", { name, input }) as { result: unknown };
    return response.result;
  }

  async stop(): Promise<void> {
    await this.request("POST", "/stop", {});
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.state.port}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.state.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000)
      });
      const value = await response.json() as { error?: { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> } };
      if (!response.ok || value.error) {
        const error = value.error ?? {};
        throw new RuntimeError((error.code as never) ?? "INTERNAL", error.message ?? `Runtime HTTP ${response.status}`, error.retryable ?? false, error.details);
      }
      return value;
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("NETWORK", error instanceof Error ? error.message : "Runtime request failed", true);
    }
  }
}

async function stopRuntime(state: RuntimeState): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/stop`, {
      method: "POST",
      headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilStopped(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isProcessRunning(pid)) await delay(50);
}

async function healthy(state: RuntimeState): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      headers: { authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(800)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function startDetachedRuntime(): void {
  const compiledCli = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  const entry = fs.existsSync(compiledCli) ? compiledCli : process.argv[1];
  if (!entry) throw new RuntimeError("INTERNAL", "Cannot locate the OKX runtime CLI entry point");
  const child = spawn(process.execPath, [entry, "daemon"], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearDeadRuntimeFiles(state?: RuntimeState): void {
  if (state && !isProcessRunning(state.pid)) {
    try { fs.unlinkSync(RUNTIME_STATE_PATH); } catch {}
  }
  try {
    const lockPid = Number(fs.readFileSync(RUNTIME_LOCK_PATH, "utf8"));
    if (!Number.isInteger(lockPid) || !isProcessRunning(lockPid)) fs.unlinkSync(RUNTIME_LOCK_PATH);
  } catch {}
}
