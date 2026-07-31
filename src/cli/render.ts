export function formatRuntimeStatus(health: Record<string, unknown>): string {
  const websocket = health.websocket as Record<string, Record<string, unknown>> | undefined;
  const subscriptions = Array.isArray(health.subscriptions) ? health.subscriptions as Array<Record<string, unknown>> : [];
  const accounts = Array.isArray(health.accounts) ? health.accounts as Array<Record<string, unknown>> : [];
  const privateWebsocket = Array.isArray(health.privateWebsocket) ? health.privateWebsocket as Array<Record<string, unknown>> : [];
  const database = health.database as Record<string, unknown> | undefined;
  const lines = [
    "Desic OKX Runtime",
    "",
    `Version       ${String(health.version ?? "unknown")}`,
    `PID           ${String(health.pid ?? "unknown")}`,
    `Uptime        ${formatDuration(Number(health.uptimeMs))}`,
    `Proxy         ${String(health.proxy ?? "unknown")}`,
    `Public WS     ${String(websocket?.public?.state ?? "unknown")}`,
    `Business WS   ${String(websocket?.business?.state ?? "unknown")}`,
    `Subscriptions ${subscriptions.length}`,
    `Accounts      ${accounts.length}`,
    `Database      ${formatBytes(Number(database?.sizeBytes ?? 0))}`
  ];
  if (subscriptions.length) {
    lines.push("", "Market data");
    for (const item of subscriptions) {
      const ages = item.ageMs as Record<string, unknown> | undefined;
      lines.push(`  ${String(item.instId)}  ticker ${formatAge(ages?.ticker)}  book ${formatAge(ages?.orderBook)}  trades ${formatAge(ages?.trades)}`);
    }
  }
  if (accounts.length) {
    lines.push("", "Accounts");
    for (const account of accounts) {
      const connection = privateWebsocket.find((item) => item.account === account.name);
      lines.push(`  ${String(account.name)}  ${String(account.environment)}${account.default ? "  default" : ""}  private WS ${String(connection?.state ?? "waiting")}${connection?.authenticated ? " authenticated" : ""}`);
    }
  }
  return lines.join("\n");
}

export function formatToolHelp(help: { name: string; description: string; accountRequirement: string; inputSchema: unknown; example: Record<string, unknown> }): string {
  const input = JSON.stringify(help.example);
  const cliInput = process.platform === "win32" ? `"${input.replaceAll('"', '\\"')}"` : `'${input.replaceAll("'", "'\\''")}'`;
  return [
    help.name,
    help.description,
    `Account: ${help.accountRequirement}`,
    "",
    "Example input:",
    JSON.stringify(help.example, null, 2),
    "",
    "CLI:",
    `desic-okx call ${help.name} --json ${cliInput}`,
    "",
    "Input schema:",
    JSON.stringify(help.inputSchema, null, 2)
  ].join("\n");
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatAge(value: unknown): string {
  return typeof value === "number" ? `${Math.round(value)}ms` : "waiting";
}
