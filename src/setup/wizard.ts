import * as prompts from "@clack/prompts";
import { detectAccountEnvironment } from "../account/service.js";
import { loadStoredConfig, saveConfig } from "../config/loader.js";
import { CONFIG_PATH } from "../config/paths.js";
import { publicError } from "../core/errors.js";
import { OkxClient } from "../core/okx-client.js";
import { checkOkxConnectivity, OKX_REST_BASE_URL, type ConnectivityResult } from "../network/connectivity.js";
import { displayProxy, normalizeProxyUrl, resolveProxy, type ResolvedProxy } from "../network/proxy.js";
import {
  SETUP_TARGETS,
  SetupCancelledError,
  setupSucceeded,
  setupTargets,
  type SetupResult,
  type SetupTarget
} from "./installer.js";

export interface SetupWizardResult {
  targets: SetupTarget[];
  results: SetupResult[];
  network?: ConnectivityResult;
  proxy: ResolvedProxy;
  proxyChanged: boolean;
  networkSkipped: boolean;
  accountChanged: boolean;
  accountSkipped: boolean;
  accountName?: string;
}

const TARGET_LABELS: Record<SetupTarget, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code / GitHub Copilot",
  cline: "Cline"
};

export async function runSetupWizard(options: { skipNetworkCheck?: boolean } = {}): Promise<SetupWizardResult> {
  prompts.intro("Desic OKX Agent setup");
  const selection = await prompts.multiselect({
    message: "Choose AI clients to configure",
    options: [
      { value: "all", label: "All supported clients", hint: "MCP for all clients; Skills where supported" },
      { value: "codex", label: "Codex", hint: "MCP + 7 Skills" },
      { value: "claude-code", label: "Claude Code", hint: "MCP + 7 Skills" },
      { value: "cursor", label: "Cursor", hint: "MCP" },
      { value: "vscode", label: "VS Code / GitHub Copilot", hint: "MCP" },
      { value: "cline", label: "Cline", hint: "MCP" }
    ],
    required: true
  });
  cancelIfNeeded(selection);
  const selected = selection as string[];
  const targets = selected.includes("all") ? [...SETUP_TARGETS] : selected as SetupTarget[];

  const setupSpinner = prompts.spinner();
  setupSpinner.start("Configuring clients and installing Skills");
  const results = setupTargets(targets);
  setupSpinner.stop(setupSucceeded(results) ? "Client setup complete" : "Client setup finished with errors");
  prompts.note(formatClientResults(results), "Client setup");

  let config = loadStoredConfig();
  let proxy = resolveProxy(config.proxy.url);
  let network = options.skipNetworkCheck ? undefined : await checkWithSpinner(proxy);
  let proxyChanged = false;
  let networkSkipped = options.skipNetworkCheck ?? false;

  while (network && !network.ok) {
    prompts.log.warn(formatNetworkFailure(network, proxy));
    const action = await prompts.select({
      message: "OKX is not reachable. How should setup continue?",
      options: [
        { value: "proxy", label: "Configure an HTTP proxy", hint: "Test before saving" },
        { value: "retry", label: "Retry network check", hint: "Use the current connection settings" },
        { value: "skip", label: "Continue without network", hint: "Configure later" }
      ]
    });
    cancelIfNeeded(action);

    if (action === "skip") {
      networkSkipped = true;
      break;
    }
    if (action === "retry") {
      proxy = resolveProxy(config.proxy.url);
      network = await checkWithSpinner(proxy);
      continue;
    }

    const entered = await prompts.text({
      message: "Proxy URL",
      placeholder: "http://127.0.0.1:7890",
      initialValue: config.proxy.url,
      validate: (value) => {
        try {
          normalizeProxyUrl(value ?? "");
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : "Invalid proxy URL";
        }
      }
    });
    cancelIfNeeded(entered);
    const proxyUrl = normalizeProxyUrl(entered as string);
    const candidate = { url: proxyUrl, source: "config" } satisfies ResolvedProxy;
    const candidateNetwork = await checkWithSpinner(candidate);
    if (!candidateNetwork.ok) {
      proxy = candidate;
      network = candidateNetwork;
      continue;
    }

    config = loadStoredConfig();
    config.proxy.url = proxyUrl;
    saveConfig(config);
    proxy = candidate;
    network = candidateNetwork;
    proxyChanged = true;
    prompts.log.success(`Proxy verified and saved to ${CONFIG_PATH}`);
  }

  if (network?.ok) prompts.log.success(formatNetworkSuccess(network, proxy));
  if (networkSkipped) prompts.log.warn("Network check skipped. Public and trading tools may be unavailable.");
  const account = await configureAccount(network?.ok === true, proxy);
  const succeeded = setupSucceeded(results) && (network?.ok || networkSkipped);
  prompts.outro(succeeded
    ? formatSetupComplete(account)
    : "Setup finished with errors. Review the failed clients above.");
  return {
    targets,
    results,
    network,
    proxy,
    proxyChanged,
    networkSkipped,
    accountChanged: account.changed,
    accountSkipped: account.skipped,
    accountName: account.name
  };
}

interface AccountSetupResult {
  changed: boolean;
  skipped: boolean;
  name?: string;
}

async function configureAccount(networkAvailable: boolean, proxy: ResolvedProxy): Promise<AccountSetupResult> {
  const stored = loadStoredConfig();
  const existingNames = Object.keys(stored.accounts);
  prompts.note([
    "Public market and derivatives tools work without an API key.",
    "An API key is required for account and trading tools.",
    "Remote News and Smart Money also require a live-account API key; read-only permission is sufficient.",
    "Create the key in the official OKX website or app. You can skip this step and run `desic-okx account add` later."
  ].join("\n"), "OKX API account (optional)");

  if (!networkAvailable) {
    prompts.log.info("Account setup skipped because OKX connectivity was not verified. Configure it later with `desic-okx account add`.");
    return { changed: false, skipped: true };
  }

  const action = await prompts.select({
    message: existingNames.length
      ? `${existingNames.length} OKX account(s) already configured. What would you like to do?`
      : "Would you like to configure an OKX API account now?",
    options: existingNames.length
      ? [
          { value: "keep", label: "Keep existing accounts", hint: "You can add or edit accounts later" },
          { value: "add", label: "Add another account", hint: "Verify before saving" }
        ]
      : [
          { value: "add", label: "Configure an account now", hint: "Verify before saving" },
          { value: "keep", label: "Skip for now", hint: "Public tools remain available" }
        ]
  });
  cancelIfNeeded(action);
  if (action === "keep") {
    prompts.log.info(existingNames.length
      ? "Existing account configuration kept."
      : "API account setup skipped. Run `desic-okx account add` whenever you need private tools.");
    return { changed: false, skipped: true };
  }

  while (true) {
    const nameValue = await prompts.text({
      message: "Account alias",
      placeholder: "default",
      defaultValue: "default",
      validate: (value) => {
        const normalized = value?.trim() ?? "";
        if (!normalized) return "Account alias is required";
        if (normalized.length > 64) return "Account alias must be 64 characters or fewer";
        if (existingNames.includes(normalized)) return `Account '${normalized}' already exists; use a different alias or run desic-okx account edit`;
        return undefined;
      }
    });
    cancelIfNeeded(nameValue);
    const name = (nameValue as string).trim();

    const apiKey = await requiredPassword("API Key");
    const secretKey = await requiredPassword("Secret Key");
    const passphrase = await requiredPassword("Passphrase");
    const spinner = prompts.spinner();
    spinner.start(`Verifying '${name}' and detecting its OKX environment`);
    try {
      const client = new OkxClient(OKX_REST_BASE_URL, proxy.url);
      const detected = await detectAccountEnvironment(client, { name, apiKey, secretKey, passphrase });
      const candidate = loadStoredConfig();
      candidate.accounts[name] = {
        environment: detected.account.environment,
        apiKey,
        secretKey,
        passphrase
      };
      candidate.defaultAccount ??= name;
      saveConfig(candidate);
      spinner.stop(`Account '${name}' verified as ${detected.account.environment} and saved`);
      prompts.note(formatAccountPermissions(detected.account.environment, detected.config), "OKX account");
      return { changed: true, skipped: false, name };
    } catch (error) {
      spinner.stop(`Could not verify account '${name}'`);
      prompts.log.warn(String(publicError(error).message));
      const next = await prompts.select({
        message: "How should account setup continue?",
        options: [
          { value: "retry", label: "Try again", hint: "Re-enter the account and credentials" },
          { value: "skip", label: "Skip for now", hint: "No credentials will be saved" }
        ]
      });
      cancelIfNeeded(next);
      if (next === "skip") {
        prompts.log.info("No API credentials were saved. Run `desic-okx account add` later.");
        return { changed: false, skipped: true };
      }
    }
  }
}

async function requiredPassword(message: string): Promise<string> {
  const value = await prompts.password({
    message,
    mask: "*",
    validate: (input) => input?.trim() ? undefined : `${message} is required`
  });
  cancelIfNeeded(value);
  return (value as string).trim();
}

function formatAccountPermissions(environment: "demo" | "live", data: Record<string, unknown>): string {
  const permission = String(data.perm ?? data.permissions ?? "reported by OKX");
  return `Saved to ${CONFIG_PATH}\nDetected environment: ${environment}\nAPI permissions: ${permission}`;
}

function formatSetupComplete(account: AccountSetupResult): string {
  const accountMessage = account.changed
    ? `OKX account '${account.name}' is ready.`
    : "Public tools are ready. Configure an API account later when private tools are needed.";
  return `Setup complete. ${accountMessage} Restart the selected AI clients, then run \`desic-okx doctor\`.`;
}

async function checkWithSpinner(proxy: ResolvedProxy): Promise<ConnectivityResult> {
  const spinner = prompts.spinner();
  spinner.start(`Checking OKX REST and WebSocket via ${displayProxy(proxy)}`);
  const result = await checkOkxConnectivity(proxy.url);
  spinner.stop(result.ok ? "OKX network check passed" : "OKX network check failed");
  return result;
}

function formatClientResults(results: SetupResult[]): string {
  return results.flatMap((result) => [
    `${TARGET_LABELS[result.target]}: MCP ${result.mcp}, Skills ${result.skills}`,
    ...result.details.map((detail) => `  ${detail}`)
  ]).join("\n");
}

function formatNetworkSuccess(result: ConnectivityResult, proxy: ResolvedProxy): string {
  return `OKX connected via ${displayProxy(proxy)} (${formatSuccessfulStep("REST", result.rest)}, ${formatSuccessfulStep("WebSocket", result.websocket)})`;
}

function formatNetworkFailure(result: ConnectivityResult, proxy: ResolvedProxy): string {
  const rest = result.rest.ok
    ? formatSuccessfulStep("REST", result.rest)
    : `REST failed after ${result.rest.attempts} attempts: ${result.rest.error ?? "unreachable"}`;
  const websocket = result.websocket.ok
    ? formatSuccessfulStep("WebSocket", result.websocket)
    : `WebSocket failed after ${result.websocket.attempts} attempts: ${result.websocket.error ?? "unreachable"}`;
  return `Could not reach OKX via ${displayProxy(proxy)}\n${rest}\n${websocket}`;
}

function formatSuccessfulStep(name: string, step: ConnectivityResult["rest"]): string {
  const retries = step.attempts > 1 ? `, ${step.attempts} attempts` : "";
  return `${name} ${step.latencyMs}ms${retries}`;
}

function cancelIfNeeded(value: unknown): void {
  if (!prompts.isCancel(value)) return;
  prompts.cancel("Setup cancelled");
  throw new SetupCancelledError();
}
