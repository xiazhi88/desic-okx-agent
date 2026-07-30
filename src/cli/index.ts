#!/usr/bin/env node
import { Command } from "commander";
import { accountSummaries, loadConfig, loadStoredConfig, saveConfig } from "../config/loader.js";
import { CONFIG_PATH } from "../config/paths.js";
import { OkxClient } from "../core/okx-client.js";
import { publicError } from "../core/errors.js";
import { AccountService } from "../account/service.js";
import { runMcpServer } from "../mcp/server.js";
import { RuntimeClient } from "../runtime/client.js";
import { runRuntimeServer } from "../runtime/server.js";
import { ask, askSecret } from "./prompts.js";

const program = new Command()
  .name("desic-okx")
  .description("Independent Desic runtime, MCP server, CLI, and skills for OKX")
  .version("0.1.0");

program.command("start")
  .description("Start or reuse the local runtime")
  .action(async () => {
    const client = await RuntimeClient.connect();
    print(await client.health());
  });

program.command("daemon", { hidden: true })
  .action(async () => runRuntimeServer());

program.command("stop")
  .description("Stop the local runtime")
  .action(async () => {
    const client = await RuntimeClient.connect({ start: false });
    await client.stop();
    print({ stopped: true });
  });

program.command("status")
  .description("Show local runtime status")
  .action(async () => {
    const client = await RuntimeClient.connect({ start: false });
    print(await client.health());
  });

program.command("mcp")
  .description("Run the stdio MCP adapter")
  .action(async () => runMcpServer());

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
    config.accounts[name] = { environment: environmentValue, apiKey, secretKey, passphrase };
    config.defaultAccount ??= name;
    saveConfig(config);
    await stopForReload();
    print({ saved: true, name, environment: environmentValue, configPath: CONFIG_PATH });
  });

account.command("list")
  .description("List configured account aliases")
  .action(() => print(accountSummaries(loadConfig())));

account.command("verify")
  .description("Verify one account and show OKX-reported permissions")
  .option("--name <name>", "account alias")
  .action(async (options: { name?: string }) => {
    const config = loadConfig();
    const client = new OkxClient("https://www.okx.com", config.proxy.url);
    const service = new AccountService(config, client);
    print(await service.verify(options.name));
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

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: publicError(error) })}\n`);
  process.exitCode = 1;
});

async function stopForReload(): Promise<void> {
  try {
    const client = await RuntimeClient.connect({ start: false });
    await client.stop();
  } catch {}
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
