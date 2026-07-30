import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR, RUNTIME_LOCK_PATH, RUNTIME_STATE_PATH } from "../config/paths.js";

const LIFECYCLE_LOG_PATH = path.join(RUNTIME_DIR, "lifecycle.log");

export interface RuntimeState {
  instanceId: string;
  pid: number;
  port: number;
  token: string;
  startedAt: number;
  version: string;
}

export function readRuntimeState(): RuntimeState | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(RUNTIME_STATE_PATH, "utf8")) as RuntimeState;
    if (!value.pid || !value.port || !value.token || !value.instanceId) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function writeRuntimeState(state: RuntimeState): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${RUNTIME_STATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, RUNTIME_STATE_PATH);
  fs.chmodSync(RUNTIME_STATE_PATH, 0o600);
  appendRuntimeLifecycle("state-written", { instanceId: state.instanceId, port: state.port });
}

export function acquireRuntimeLock(): number {
  fs.mkdirSync(path.dirname(RUNTIME_LOCK_PATH), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(RUNTIME_LOCK_PATH), 0o700);
  try {
    const descriptor = fs.openSync(RUNTIME_LOCK_PATH, "wx", 0o600);
    fs.writeFileSync(descriptor, String(process.pid));
    appendRuntimeLifecycle("lock-acquired");
    return descriptor;
  } catch (error) {
    const state = readRuntimeState();
    if (state && isProcessRunning(state.pid)) throw new Error(`Runtime is already running with PID ${state.pid}`);
    const lockPid = Number(readText(RUNTIME_LOCK_PATH));
    if (Number.isInteger(lockPid) && isProcessRunning(lockPid)) throw new Error(`Runtime is starting with PID ${lockPid}`);
    try {
      const stat = fs.statSync(RUNTIME_LOCK_PATH);
      if (Date.now() - stat.mtimeMs < 10_000) throw error;
      fs.unlinkSync(RUNTIME_LOCK_PATH);
      return acquireRuntimeLock();
    } catch (nested) {
      if (nested === error) throw error;
      throw nested;
    }
  }
}

export function releaseRuntimeFiles(lockDescriptor: number, instanceId: string): void {
  appendRuntimeLifecycle("state-release", { instanceId });
  try {
    const current = readRuntimeState();
    if (current?.instanceId === instanceId) fs.unlinkSync(RUNTIME_STATE_PATH);
  } catch {}
  try { fs.closeSync(lockDescriptor); } catch {}
  try {
    if (Number(readText(RUNTIME_LOCK_PATH)) === process.pid) fs.unlinkSync(RUNTIME_LOCK_PATH);
  } catch {}
}

export function appendRuntimeLifecycle(event: string, details: Record<string, unknown> = {}): void {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(LIFECYCLE_LOG_PATH, `${JSON.stringify({ ts: Date.now(), pid: process.pid, event, ...details })}\n`, { mode: 0o600 });
    fs.chmodSync(LIFECYCLE_LOG_PATH, 0o600);
  } catch {}
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readText(file: string): string {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}
