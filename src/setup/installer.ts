import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

export interface SkillSyncResult {
  target: "codex" | "claude-code";
  destination: string;
  installed: number;
  updated: number;
  unchanged: number;
  backupDirectory?: string;
  dryRun: boolean;
}

export interface SetupInspection {
  target: SetupTarget;
  mcpConfigured: boolean | null;
  skillsInstalled: number | null;
  details: string;
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
        mcp = mergeCodexMcpConfig(path.join(codexHomeDirectory(homeDir), "config.toml"), details);
        skills = configureSkills("codex", skillSourceDir, skillDirectory("codex", homeDir), details);
        break;
      case "claude-code":
        mcp = mergeMcpConfig(path.join(homeDir, ".claude.json"), details);
        skills = configureSkills("claude-code", skillSourceDir, skillDirectory("claude-code", homeDir), details);
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

export function mergeCodexMcpConfig(configPath: string, details: string[]): SetupStatus {
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const section = /^\s*\[\s*mcp_servers\.(?:desic-okx|"desic-okx")\s*\]\s*(?:#.*)?$/m;
  if (section.test(current)) {
    details.push(`MCP already exists in ${configPath}`);
    return "existing";
  }

  const separator = current.length === 0 || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  const server = `[mcp_servers.${SERVER_NAME}]\ncommand = "${SERVER_CONFIG.command}"\nargs = ["mcp"]\n`;
  writeText(configPath, `${current}${separator}${server}`);
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
  writeText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(targetPath: string, value: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, targetPath);
}

function installSkills(target: "codex" | "claude-code", sourceDir: string, destinationDir: string, details: string[]): SetupStatus {
  const result = syncSkillDirectory(target, sourceDir, destinationDir, false);
  details.push(`Skills: ${result.installed} installed, ${result.updated} updated, ${result.unchanged} current in ${destinationDir}`);
  if (result.backupDirectory) details.push(`Previous Skills backed up in ${result.backupDirectory}`);
  return result.installed === 0 && result.updated === 0 ? "existing" : "configured";
}

function copyDirectory(sourceDir: string, destinationDir: string): void {
  fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, destination);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    } else {
      throw new Error(`Unsupported Skill entry: ${source}`);
    }
  }
}

function configureSkills(target: "codex" | "claude-code", sourceDir: string, destinationDir: string, details: string[]): SetupStatus {
  try {
    return installSkills(target, sourceDir, destinationDir, details);
  } catch (error) {
    details.push(error instanceof Error ? error.message : "Could not install skills");
    return "failed";
  }
}

function skillDirectory(target: "codex" | "claude-code", homeDir: string): string {
  if (target === "codex") return path.join(codexHomeDirectory(homeDir), "skills");
  return path.join(homeDir, ".claude", "skills");
}

function codexHomeDirectory(homeDir: string): string {
  return process.env.CODEX_HOME?.trim() || path.join(homeDir, ".codex");
}

function defaultSkillSourceDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
}

export function syncSkills(
  targets: Array<"codex" | "claude-code"> = ["codex", "claude-code"],
  options: { homeDir?: string; skillSourceDir?: string; dryRun?: boolean } = {}
): SkillSyncResult[] {
  const homeDir = options.homeDir ?? os.homedir();
  const sourceDir = options.skillSourceDir ?? defaultSkillSourceDir();
  return targets.map((target) => syncSkillDirectory(target, sourceDir, skillDirectory(target, homeDir), options.dryRun ?? false));
}

export function inspectSetupTargets(homeDir = os.homedir()): SetupInspection[] {
  return SETUP_TARGETS.map((target) => {
    if (target === "vscode") return { target, mcpConfigured: null, skillsInstalled: null, details: "Use VS Code to inspect configured MCP servers" };
    if (target === "codex") {
      const configPath = path.join(codexHomeDirectory(homeDir), "config.toml");
      const content = readText(configPath);
      return inspection(target, /^\s*\[\s*mcp_servers\.(?:desic-okx|"desic-okx")\s*\]/m.test(content), skillDirectory("codex", homeDir), configPath);
    }
    const configPath = target === "claude-code" ? path.join(homeDir, ".claude.json")
      : target === "cursor" ? path.join(homeDir, ".cursor", "mcp.json")
        : path.join(homeDir, ".cline", "data", "settings", "mcp.json");
    return inspection(target, jsonHasServer(configPath), target === "claude-code" ? skillDirectory("claude-code", homeDir) : undefined, configPath);
  });
}

function syncSkillDirectory(
  target: "codex" | "claude-code",
  sourceDir: string,
  destinationDir: string,
  dryRun: boolean
): SkillSyncResult {
  if (!fs.existsSync(sourceDir)) throw new Error(`Skills are unavailable at ${sourceDir}`);
  const skills = bundledSkillNames(sourceDir);
  let installed = 0;
  let updated = 0;
  let unchanged = 0;
  let backupDirectory: string | undefined;
  if (!dryRun) fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
  for (const skill of skills) {
    const source = path.join(sourceDir, skill);
    const destination = path.join(destinationDir, skill);
    if (!fs.existsSync(destination)) {
      installed += 1;
      if (!dryRun) copyDirectory(source, destination);
      continue;
    }
    if (directoryDigest(source) === directoryDigest(destination)) {
      unchanged += 1;
      continue;
    }
    updated += 1;
    if (dryRun) continue;
    backupDirectory ??= path.join(destinationDir, ".desic-okx-backups", timestampDirectory());
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    fs.renameSync(destination, path.join(backupDirectory, skill));
    copyDirectory(source, destination);
  }
  return { target, destination: destinationDir, installed, updated, unchanged, ...(backupDirectory ? { backupDirectory } : {}), dryRun };
}

function bundledSkillNames(sourceDir: string): string[] {
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(sourceDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function directoryDigest(directory: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string, relative = ""): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nextRelative = path.join(relative, entry.name);
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute, nextRelative);
      else if (entry.isFile()) {
        hash.update(nextRelative.replaceAll(path.sep, "/"));
        hash.update(fs.readFileSync(absolute));
      }
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function timestampDirectory(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function inspection(target: SetupTarget, mcpConfigured: boolean, skillsDir: string | undefined, configPath: string): SetupInspection {
  const skillsInstalled = skillsDir && fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md"))).length
    : skillsDir ? 0 : null;
  return { target, mcpConfigured, skillsInstalled, details: configPath };
}

function jsonHasServer(configPath: string): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as McpConfig;
    return Boolean(config.mcpServers && SERVER_NAME in config.mcpServers);
  } catch { return false; }
}

function readText(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
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
