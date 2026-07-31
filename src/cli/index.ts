#!/usr/bin/env node
import { Command } from "commander";
import * as prompts from "@clack/prompts";
import { accountSummaries, loadConfig, loadStoredConfig, saveConfig } from "../config/loader.js";
import { CONFIG_PATH } from "../config/paths.js";
import { OkxClient } from "../core/okx-client.js";
import { publicError } from "../core/errors.js";
import { PACKAGE_VERSION } from "../core/version.js";
import { checkOkxConnectivity, OKX_REST_BASE_URL } from "../network/connectivity.js";
import { displayProxy, resolveProxy } from "../network/proxy.js";
import { AccountService } from "../account/service.js";
import { runMcpServer } from "../mcp/server.js";
import { RuntimeClient } from "../runtime/client.js";
import { ask, askConfirm, askSecret } from "./prompts.js";
import { SetupCancelledError, inspectSetupTargets, parseSetupTargets, SETUP_TARGETS, setupSucceeded, setupSummary, setupTargets, syncSkills } from "../setup/installer.js";
import { runSetupWizard } from "../setup/wizard.js";
import { runDoctor, formatDoctor } from "./doctor.js";
import { formatRuntimeStatus, formatToolHelp } from "./render.js";
import { getToolHelp } from "../tools/help.js";
import { checkForUpdate, installLatestVersion, OFFICIAL_NPM_REGISTRY, runInstalledCommand } from "../update/service.js";

const program = new Command()
  .name("desic-okx")
  .description("Independent Desic runtime, MCP server, CLI, and skills for OKX")
  .version(PACKAGE_VERSION);

program.command("start")
  .description("Start or reuse the local runtime")
  .action(async () => {
    const client = await RuntimeClient.connect();
    print(await client.health());
  });

program.command("daemon", { hidden: true })
  .action(async () => {
    // Keep native SQLite out of long-lived MCP adapter processes on Windows.
    const { runRuntimeServer } = await import("../runtime/server.js");
    await runRuntimeServer();
  });

program.command("stop")
  .description("Stop the local runtime")
  .action(async () => {
    const client = await RuntimeClient.connect({ start: false });
    await client.stop();
    print({ stopped: true });
  });

program.command("status")
  .description("Show local runtime status")
  .option("--json", "Print machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const client = await RuntimeClient.connect({ start: false });
    const health = await client.health();
    if (options.json || !process.stdout.isTTY) print(health);
    else process.stdout.write(`${formatRuntimeStatus(health)}\n`);
  });

program.command("doctor")
  .description("Diagnose installation, network, Runtime, Skills, and accounts")
  .option("--json", "Print machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    if (options.json || !process.stdout.isTTY) print(report);
    else process.stdout.write(`${formatDoctor(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  });

program.command("mcp")
  .description("Run the stdio MCP adapter")
  .action(async () => runMcpServer());

program.command("setup")
  .description("Interactively configure supported AI clients and install compatible skills")
  .option("--targets <targets>", `Comma-separated targets: ${SETUP_TARGETS.join(", ")}, all`)
  .option("--all", "Configure every supported target")
  .option("--yes", "Run without interactive prompts; defaults to all targets when none are specified")
  .option("--skip-network-check", "Skip OKX REST and WebSocket connectivity checks")
  .action(async (options: { targets?: string; all?: boolean; yes?: boolean; skipNetworkCheck?: boolean }) => {
    const interactive = !options.all && !options.targets && !options.yes;
    if (interactive) {
      const outcome = await runSetupWizard({ skipNetworkCheck: options.skipNetworkCheck });
      if (outcome.proxyChanged || outcome.accountChanged) await stopForReload();
      if (!setupSucceeded(outcome.results) || (outcome.network && !outcome.network.ok && !outcome.networkSkipped)) process.exitCode = 1;
      return;
    }
    const targets = options.all ? [...SETUP_TARGETS]
      : options.targets ? parseSetupTargets(options.targets)
        : [...SETUP_TARGETS];
    const results = setupTargets(targets);
    const proxy = resolveProxy(loadStoredConfig().proxy.url);
    const network = options.skipNetworkCheck ? undefined : await checkOkxConnectivity(proxy.url);
    print({
      targets,
      results,
      summary: setupSummary(results),
      network: network ? { ...network, connection: displayProxy(proxy) } : { skipped: true }
    });
    if (!setupSucceeded(results) || (network && !network.ok)) process.exitCode = 1;
  });

program.command("call")
  .description("Call one runtime tool")
  .argument("<tool>", "tool name")
  .option("--json <json>", "JSON input", "{}")
  .action(async (tool: string, options: { json: string }) => {
    const input = JSON.parse(options.json) as unknown;
    const client = await RuntimeClient.connect();
    print(await client.call(tool, input));
  });

program.command("tools")
  .description("List available runtime tools")
  .action(async () => {
    const client = await RuntimeClient.connect();
    print(await client.tools());
  });

program.command("tool")
  .description("Show one tool's requirements, schema, and example")
  .argument("<name>", "tool name")
  .option("--json", "Print machine-readable JSON")
  .action((name: string, options: { json?: boolean }) => {
    const help = getToolHelp(name);
    if (!help) throw new Error(`Unknown tool '${name}'`);
    if (options.json || !process.stdout.isTTY) print(help);
    else process.stdout.write(`${formatToolHelp(help)}\n`);
  });

const skills = program.command("skills").description("Inspect and synchronize bundled Skills");

skills.command("status")
  .description("Show pending Skill installations and updates")
  .option("--targets <targets>", "codex,claude-code; defaults to detected installations")
  .action((options: { targets?: string }) => print(syncSkills(resolveSkillTargets(options.targets), { dryRun: true })));

skills.command("sync")
  .description("Install or update bundled Skills, backing up changed copies")
  .option("--targets <targets>", "codex,claude-code; defaults to detected installations")
  .option("--dry-run", "Show changes without writing")
  .action((options: { targets?: string; dryRun?: boolean }) => print(syncSkills(resolveSkillTargets(options.targets), { dryRun: options.dryRun })));

program.command("update")
  .description("Check for and install the latest npm release safely")
  .option("--check", "Only check for a newer version")
  .option("--yes", "Install without confirmation")
  .option("--registry <url>", "npm registry", OFFICIAL_NPM_REGISTRY)
  .action(async (options: { check?: boolean; yes?: boolean; registry: string }) => {
    const info = await checkForUpdate(options.registry, loadStoredConfig().proxy.url);
    if (options.check || !info.updateAvailable) {
      print(info);
      return;
    }
    let approved = options.yes === true;
    if (!approved && process.stdin.isTTY) {
      const answer = await prompts.confirm({ message: `Update ${info.current} to ${info.latest}?` });
      if (prompts.isCancel(answer) || answer === false) throw new SetupCancelledError();
      approved = true;
    }
    if (!approved) throw new Error("Use --yes to update in a non-interactive terminal");
    const exitCode = await installLatestVersion(info);
    if (exitCode !== 0) throw new Error(`npm exited with code ${exitCode}`);
    process.stdout.write(`Updated to ${info.latest}. Synchronizing installed Skills...\n`);
    const skillExit = await runInstalledCommand(["skills", "sync"]);
    if (skillExit !== 0) process.stderr.write("The package was updated, but Skill synchronization needs attention.\n");
    process.stdout.write("Verifying the updated installation...\n");
    const doctorExit = await runInstalledCommand(["doctor"]);
    if (doctorExit !== 0) process.stderr.write("The package was updated, but Doctor reported an issue.\n");
  });

program.command("config-path")
  .description("Print the active configuration path")
  .action(() => {
    process.stdout.write(`${CONFIG_PATH}\n`);
  });

const account = program.command("account").description("Manage named OKX accounts");

account.command("add")
  .description("Add or replace a named account")
  .option("--name <name>", "account alias")
  .option("--environment <environment>", "demo or live")
  .action(async (options: { name?: string; environment?: string }) => {
    const name = options.name?.trim() || await ask("Account name", "default");
    const environmentValue = options.environment?.trim() || await ask("Environment (demo/live)", "demo");
    if (environmentValue !== "demo" && environmentValue !== "live") throw new Error("Environment must be demo or live");
    const apiKey = await askSecret("API Key");
    const secretKey = await askSecret("Secret Key");
    const passphrase = await askSecret("Passphrase");
    if (!apiKey || !secretKey || !passphrase) throw new Error("All three credential fields are required");
    const config = loadStoredConfig();
    const candidate = structuredClone(config);
    candidate.accounts[name] = { environment: environmentValue, apiKey, secretKey, passphrase };
    candidate.defaultAccount ??= name;
    const verified = await verifyAccount(candidate, name);
    saveConfig(candidate);
    await stopForReload();
    print({ saved: true, name, environment: environmentValue, permissions: verified.data, configPath: CONFIG_PATH });
  });

account.command("list")
  .description("List configured account aliases")
  .action(() => print(accountSummaries(loadConfig())));

account.command("verify")
  .description("Verify one account and show OKX-reported permissions")
  .option("--name <name>", "account alias")
  .option("--all", "Verify all configured accounts")
  .action(async (options: { name?: string; all?: boolean }) => {
    const config = loadConfig();
    const client = new OkxClient(OKX_REST_BASE_URL, resolveProxy(config.proxy.url).url);
    const service = new AccountService(config, client);
    if (options.all) {
      const results = await Promise.all(Object.keys(config.accounts).map(async (name) => {
        try { return { name, ok: true, result: await service.verify(name) }; }
        catch (error) { return { name, ok: false, error: publicError(error) }; }
      }));
      print(results);
      if (results.some((result) => !result.ok)) process.exitCode = 1;
    } else {
      print(await service.verify(options.name));
    }
  });

account.command("set-default")
  .description("Set the default account alias")
  .argument("<name>", "account alias")
  .action(async (name: string) => {
    const config = loadStoredConfig();
    if (!config.accounts[name]) throw new Error(`Account '${name}' was not found`);
    config.defaultAccount = name;
    saveConfig(config);
    await stopForReload();
    print({ saved: true, defaultAccount: name });
  });

account.command("rename")
  .description("Rename an account alias")
  .argument("<oldName>", "current account alias")
  .argument("<newName>", "new account alias")
  .action(async (oldName: string, newName: string) => {
    const config = loadStoredConfig();
    if (!config.accounts[oldName]) throw new Error(`Account '${oldName}' was not found`);
    if (config.accounts[newName]) throw new Error(`Account '${newName}' already exists`);
    config.accounts[newName] = config.accounts[oldName];
    delete config.accounts[oldName];
    if (config.defaultAccount === oldName) config.defaultAccount = newName;
    saveConfig(config);
    await stopForReload();
    print({ renamed: true, from: oldName, to: newName, default: config.defaultAccount === newName });
  });

account.command("edit")
  .description("Edit an account environment or replace its credentials")
  .argument("<name>", "account alias")
  .option("--environment <environment>", "demo or live")
  .option("--replace-credentials", "Prompt for replacement credentials")
  .action(async (name: string, options: { environment?: string; replaceCredentials?: boolean }) => {
    const config = loadStoredConfig();
    const current = config.accounts[name];
    if (!current) throw new Error(`Account '${name}' was not found`);
    const environment = options.environment?.trim() || await ask("Environment (demo/live)", current.environment);
    if (environment !== "demo" && environment !== "live") throw new Error("Environment must be demo or live");
    const normalizedEnvironment: "demo" | "live" = environment;
    const replace = options.replaceCredentials ?? await askConfirm("Replace API credentials", false);
    const updated = { ...current, environment: normalizedEnvironment };
    if (replace) {
      updated.apiKey = await askSecret("API Key");
      updated.secretKey = await askSecret("Secret Key");
      updated.passphrase = await askSecret("Passphrase");
      if (!updated.apiKey || !updated.secretKey || !updated.passphrase) throw new Error("All three credential fields are required");
    }
    const candidate = structuredClone(config);
    candidate.accounts[name] = updated;
    const verified = await verifyAccount(candidate, name);
    saveConfig(candidate);
    await stopForReload();
    print({ saved: true, name, environment, permissions: verified.data });
  });

account.command("remove")
  .description("Remove one account")
  .argument("<name>", "account alias")
  .action(async (name: string) => {
    const config = loadStoredConfig();
    if (!config.accounts[name]) throw new Error(`Account '${name}' was not found`);
    delete config.accounts[name];
    if (config.defaultAccount === name) config.defaultAccount = Object.keys(config.accounts)[0];
    saveConfig(config);
    await stopForReload();
    print({ removed: true, name });
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (!(error instanceof SetupCancelledError)) {
    process.stderr.write(`${JSON.stringify({ error: publicError(error) })}\n`);
    process.exitCode = 1;
  }
}

async function stopForReload(): Promise<void> {
  try {
    const client = await RuntimeClient.connect({ start: false });
    await client.stop();
  } catch {}
}

async function verifyAccount(config: ReturnType<typeof loadStoredConfig>, name: string): Promise<Awaited<ReturnType<AccountService["verify"]>>> {
  const client = new OkxClient(OKX_REST_BASE_URL, resolveProxy(config.proxy.url).url);
  return new AccountService(config, client).verify(name);
}

function parseSkillTargets(value: string): Array<"codex" | "claude-code"> {
  const targets = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = targets.filter((target) => target !== "codex" && target !== "claude-code");
  if (invalid.length) throw new Error(`Unsupported Skill target: ${invalid.join(", ")}`);
  return [...new Set(targets)] as Array<"codex" | "claude-code">;
}

function resolveSkillTargets(value?: string): Array<"codex" | "claude-code"> {
  if (value) return parseSkillTargets(value);
  const detected = inspectSetupTargets()
    .filter((item) => (item.target === "codex" || item.target === "claude-code") && item.skillsInstalled !== null && item.skillsInstalled > 0)
    .map((item) => item.target as "codex" | "claude-code");
  if (!detected.length) throw new Error("No installed Codex or Claude Code Skills were detected; pass --targets to install them");
  return detected;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
