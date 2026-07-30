import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prompts from "@clack/prompts";

export const SETUP_TARGETS = ["codex", "claude-code", "cursor", "vscode", "cline"] as const;
export type SetupTarget = typeof SETUP_TARGETS[number];

type SetupStatus = "configured" | "existing" | "failed" | "not-supported";

export interface SetupResult {
  target: SetupTarget;
  mcp: SetupStatus;
  skills: SetupStatus;
  details: string[];
}

interface CommandResult {
  ok: boolean;
  message?: string;
}

interface SetupOptions {
  homeDir?: string;
  skillSourceDir?: string;
  runCommand?: (command: string, args: string[]) => CommandResult;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

const SERVER_NAME = "desic-okx";
const SERVER_CONFIG = { command: "desic-okx", args: ["mcp"] };

const TARGET_LABELS: Record<SetupTarget, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code / GitHub Copilot",
  cline: "Cline"
};

export function parseSetupTargets(value: string): SetupTarget[] {
  const requested = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (requested.includes("all")) return [...SETUP_TARGETS];
  const invalid = requested.filter((item): item is string => !SETUP_TARGETS.includes(item as SetupTarget));
  if (invalid.length > 0) throw new Error(`Unsupported setup target: ${invalid.join(", ")}`);
  if (requested.length === 0) throw new Error("At least one setup target is required");
  return [...new Set(requested as SetupTarget[])];
}

export async function chooseSetupTargets(): Promise<SetupTarget[]> {
  prompts.intro("Desic OKX Agent setup");
  const selection = await prompts.multiselect({
    message: "Choose AI clients to configure",
    options: [
      { value: "all", label: "All supported clients", hint: "Codex, Claude Code, Cursor, VS Code/Copilot, Cline" },
      { value: "codex", label: "Codex", hint: "MCP + all Desic skills" },
      { value: "claude-code", label: "Claude Code", hint: "MCP + all Desic skills" },
      { value: "cursor", label: "Cursor", hint: "MCP" },
      { value: "vscode", label: "VS Code / GitHub Copilot", hint: "MCP" },
      { value: "cline", label: "Cline", hint: "MCP" }
    ],
    required: true
  });
  if (prompts.isCancel(selection)) {
    prompts.cancel("Setup cancelled");
    throw new SetupCancelledError();
  }
  return parseSetupTargets((selection as string[]).join(","));
}

export class SetupCancelledError extends Error {
  constructor() {
    super("Setup cancelled");
  }
}

export function setupTargets(targets: SetupTarget[], options: SetupOptions = {}): SetupResult[] {
  const homeDir = options.homeDir ?? os.homedir();
  const skillSourceDir = options.skillSourceDir ?? defaultSkillSourceDir();
  const runCommand = options.runCommand ?? runExternalCommand;
  return targets.map((target) => setupTarget(target, homeDir, skillSourceDir, runCommand));
}

function setupTarget(
  target: SetupTarget,
  homeDir: string,
  skillSourceDir: string,
  runCommand: (command: string, args: string[]) => CommandResult
): SetupResult {
  const details: string[] = [];
  let mcp: SetupStatus;
  let skills: SetupStatus = "not-supported";

  try {
    switch (target) {
      case "codex":
        mcp = configureCommandTarget("codex", ["mcp", "add", SERVER_NAME, "--", SERVER_CONFIG.command, ...SERVER_CONFIG.args], runCommand, details);
        skills = configureSkills(skillSourceDir, skillDirectory("codex", homeDir), details);
        break;
      case "claude-code":
        mcp = configureCommandTarget("claude", ["mcp", "add", "--transport", "stdio", "--scope", "user", SERVER_NAME, "--", SERVER_CONFIG.command, ...SERVER_CONFIG.args], runCommand, details);
        skills = configureSkills(skillSourceDir, skillDirectory("claude-code", homeDir), details);
        break;
      case "cursor":
        mcp = mergeMcpConfig(path.join(homeDir, ".cursor", "mcp.json"), details);
        break;
      case "vscode":
        mcp = configureCommandTarget("code", ["--add-mcp", JSON.stringify({ name: SERVER_NAME, type: "stdio", ...SERVER_CONFIG })], runCommand, details);
        break;
      case "cline":
        mcp = mergeMcpConfig(path.join(homeDir, ".cline", "data", "settings", "mcp.json"), details);
        break;
    }
  } catch (error) {
    mcp = "failed";
    details.push(error instanceof Error ? error.message : "Setup failed");
  }

  return { target, mcp, skills, details };
}

function configureCommandTarget(
  command: string,
  args: string[],
  runCommand: (command: string, args: string[]) => CommandResult,
  details: string[]
): SetupStatus {
  const result = runCommand(command, args);
  if (result.ok) {
    details.push(`MCP configured with ${command}`);
    return "configured";
  }
  details.push(result.message ?? `Could not configure MCP with ${command}`);
  return "failed";
}

export function mergeMcpConfig(configPath: string, details: string[]): SetupStatus {
  const config = readMcpConfig(configPath);
  const servers = config.mcpServers ?? {};
  if (SERVER_NAME in servers) {
    details.push(`MCP already exists in ${configPath}`);
    return "existing";
  }
  config.mcpServers = { ...servers, [SERVER_NAME]: SERVER_CONFIG };
  writeJson(configPath, config);
  details.push(`MCP configured in ${configPath}`);
  return "configured";
}

function readMcpConfig(configPath: string): McpConfig {
  if (!fs.existsSync(configPath)) return {};
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Cannot safely update ${configPath}: it is not valid JSON`);
  }
  if (!isRecord(value)) throw new Error(`Cannot safely update ${configPath}: expected a JSON object`);
  if (value.mcpServers !== undefined && !isRecord(value.mcpServers)) {
    throw new Error(`Cannot safely update ${configPath}: mcpServers must be an object`);
  }
  return value as McpConfig;
}

function writeJson(targetPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, targetPath);
}

function installSkills(sourceDir: string, destinationDir: string, details: string[]): SetupStatus {
  if (!fs.existsSync(sourceDir)) {
    details.push(`Skills are unavailable at ${sourceDir}`);
    return "failed";
  }
  fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
  const skills = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(sourceDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  let installed = 0;
  let existing = 0;
  for (const skill of skills) {
    const destination = path.join(destinationDir, skill);
    if (fs.existsSync(destination)) {
      existing += 1;
      continue;
    }
    fs.cpSync(path.join(sourceDir, skill), destination, { recursive: true, force: false });
    installed += 1;
  }
  details.push(`Skills: ${installed} installed, ${existing} kept in ${destinationDir}`);
  return installed === 0 ? "existing" : "configured";
}

function configureSkills(sourceDir: string, destinationDir: string, details: string[]): SetupStatus {
  try {
    return installSkills(sourceDir, destinationDir, details);
  } catch (error) {
    details.push(error instanceof Error ? error.message : "Could not install skills");
    return "failed";
  }
}

function skillDirectory(target: "codex" | "claude-code", homeDir: string): string {
  if (target === "codex") return path.join(process.env.CODEX_HOME?.trim() || path.join(homeDir, ".codex"), "skills");
  return path.join(homeDir, ".claude", "skills");
}

function defaultSkillSourceDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
}

function runExternalCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) return { ok: false, message: `${command} is unavailable: ${result.error.message}` };
  if (result.status !== 0) return { ok: false, message: `${command} did not accept the MCP configuration` };
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function setupSucceeded(results: SetupResult[]): boolean {
  return results.every((result) => result.mcp !== "failed" && result.skills !== "failed");
}

export function setupSummary(results: SetupResult[]): string {
  return results.map((result) => `${TARGET_LABELS[result.target]}: MCP ${result.mcp}, skills ${result.skills}`).join("\n");
}
