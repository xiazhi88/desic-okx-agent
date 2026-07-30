import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const SETUP_TARGETS = ["codex", "claude-code", "cursor", "vscode", "cline"] as const;
export type SetupTarget = typeof SETUP_TARGETS[number];

type SetupStatus = "configured" | "existing" | "failed" | "not-supported";

export interface SetupResult {
  target: SetupTarget;
  mcp: SetupStatus;
  skills: SetupStatus;
  details: string[];
}

export interface CommandResult {
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

export function parseInteractiveSetupTargets(value: string): SetupTarget[] {
  const answer = value.trim().toLowerCase();
  if (answer === "q" || answer === "quit") throw new SetupCancelledError();
  if (answer === "a" || answer === "all") return [...SETUP_TARGETS];

  const targetNumbers: Record<string, SetupTarget> = {
    "1": "codex",
    "2": "claude-code",
    "3": "cursor",
    "4": "vscode",
    "5": "cline"
  };
  const requested = answer.split(/[\s,]+/).filter(Boolean);
  if (requested.length === 0) throw new Error("Select at least one client");
  const invalid = requested.filter((item) => !(item in targetNumbers));
  if (invalid.length > 0) throw new Error(`Invalid selection: ${invalid.join(", ")}`);
  return [...new Set(requested.map((item) => targetNumbers[item] as SetupTarget))];
}

export async function runInteractiveSetup(): Promise<SetupResult[]> {
  process.stdout.write([
    "Desic OKX Agent setup",
    "",
    "Select AI clients (enter one or more numbers separated by commas):",
    "  1. Codex                       MCP + all Desic skills",
    "  2. Claude Code                 MCP + all Desic skills",
    "  3. Cursor                      MCP",
    "  4. VS Code / GitHub Copilot    MCP",
    "  5. Cline                       MCP",
    "  A. All supported clients",
    "  Q. Cancel",
    ""
  ].join("\n"));

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const targets = parseInteractiveSetupTargets(await prompt.question("Selection: "));
    process.stdout.write("\nConfiguring selected clients...\n");
    const results = setupTargets(targets);
    showSetupResult(results);
    return results;
  } finally {
    prompt.close();
  }
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

export function runExternalCommand(command: string, args: string[]): CommandResult {
  const executable = resolveExecutable(command);
  const commandOptions = { encoding: "utf8" as const, windowsHide: true };
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec?.trim() || "cmd.exe", ["/d", "/c", "call", executable, ...args], commandOptions)
    : spawnSync(executable, args, commandOptions);
  if (result.error) return { ok: false, message: `${command} is unavailable: ${result.error.message}` };
  if (result.status !== 0) return { ok: false, message: `${command} did not accept the MCP configuration` };
  return { ok: true };
}

function resolveExecutable(command: string): string {
  if (process.platform !== "win32") return command;
  const lookup = spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true });
  if (lookup.status !== 0 || !lookup.stdout) return command;
  return lookup.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? command;
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

export function showSetupResult(results: SetupResult[]): void {
  const lines = ["", "Setup result"];
  for (const result of results) {
    lines.push(`${TARGET_LABELS[result.target]}: MCP ${result.mcp}, skills ${result.skills}`);
    lines.push(...result.details.map((detail) => `  - ${detail}`));
  }
  lines.push("");
  lines.push(setupSucceeded(results)
    ? "Setup complete. Restart the selected AI clients."
    : "Setup finished with errors. Review the failed targets above.");
  process.stdout.write(`${lines.join("\n")}\n`);
}
