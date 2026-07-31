import * as prompts from "@clack/prompts";
import { loadStoredConfig, saveConfig } from "../config/loader.js";
import { CONFIG_PATH } from "../config/paths.js";
import { checkOkxConnectivity, type ConnectivityResult } from "../network/connectivity.js";
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
  const succeeded = setupSucceeded(results) && (network?.ok || networkSkipped);
  prompts.outro(succeeded
    ? "Setup complete. Restart the selected AI clients."
    : "Setup finished with errors. Review the failed clients above.");
  return { targets, results, network, proxy, proxyChanged, networkSkipped };
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
