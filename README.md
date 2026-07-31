# Desic OKX Agent

An independent local OKX runtime, MCP server, CLI, and reusable agent skills for Codex, Claude Code, and other MCP clients.

> [!IMPORTANT]
> Desic OKX Agent is an independent community project. It is not affiliated with, endorsed by, or an official product of OKX.

## What it provides

- A shared local Runtime reused by multiple MCP and CLI clients
- In-memory ticker, order book, trades, candles, funding, mark price, and open-interest data
- Time-aligned decision snapshots with freshness and consistency metadata
- Public market and derivatives tools that work without API credentials
- Named OKX accounts for balances, positions, orders, fills, bills, and risk summaries
- Direct ordinary-order, algo-order, leverage, amend, cancel, and close-position operations
- Experimental News and Smart Money intelligence with SQLite history fallback
- Seven reusable analysis and trading skills
- SQLite WAL persistence for closed candles, intelligence history, derived events, and execution records

The project does not expose withdrawal, deposit, transfer, asset-movement, or API-key-management tools.

## Requirements

- Node.js 22.12 or newer
- npm
- Network access to OKX, or an HTTP/HTTPS proxy that can reach OKX

## Install

Install the published package:

```bash
npm install --global desic-okx-agent
```

This registers the `desic-okx` command on the local machine.

## Set up an AI client

Run the guided setup after installation:

```bash
desic-okx setup
```

The terminal guide lets you select Codex, Claude Code, Cursor, VS Code / GitHub Copilot, Cline, or all supported clients with the arrow keys and Space. It safely adds the `desic-okx` MCP entry without replacing other MCP servers.

For Codex and Claude Code, setup also installs all bundled Skills automatically. Cursor, VS Code / GitHub Copilot, and Cline receive MCP configuration only because they do not share a portable `SKILL.md` installation format.

Setup then checks both OKX REST and WebSocket connectivity. Transient TLS and network failures are retried before setup asks for action. When direct and detected system-proxy connections still fail, it offers to test and save an HTTP proxy URL, retry, or continue without network access.

For automation, choose explicit targets without opening the UI:

```bash
desic-okx setup --targets codex --yes
desic-okx setup --targets codex,claude-code --yes
desic-okx setup --all --yes
desic-okx setup --targets codex --yes --skip-network-check
```

Non-interactive setup exits with an error when the network check fails. Use `--skip-network-check` only when connectivity will be configured later.

Restart the selected client after setup. The MCP server starts the local Runtime automatically when it is first used. Run `desic-okx doctor` at any time to verify the package, client configuration, Skills, network, Runtime, SQLite, public market data, and configured accounts.

## Ask an AI to install it

Paste this into Codex, Claude Code, Cursor, VS Code / GitHub Copilot, or Cline. Replace `codex` with `claude-code`, `cursor`, `vscode`, `cline`, or `all` when appropriate.

```text
Install Desic OKX Agent for me. Check that Node.js is at least 22.12, then run:
npm install --global desic-okx-agent
desic-okx setup --targets codex --yes

Verify the installation with `desic-okx doctor`. Do not ask for or configure any OKX API credentials. Confirm that public market tools are ready to use.
```

For development from source:

```bash
git clone https://github.com/xiazhi88/desic-okx-agent.git
cd desic-okx-agent
npm ci
npm run build
npm link
```

## Quick start

Public market tools do not require an account:

```bash
desic-okx start
desic-okx call market_get_ticker --json '{"instId":"BTC-USDT-SWAP"}'
desic-okx call market_get_decision_snapshot --json '{"instId":"BTC-USDT-SWAP","bar":"1m"}'
```

The Runtime starts automatically when an MCP client or CLI call needs it. `desic-okx start` is optional.
The stdio MCP adapter does not load the native SQLite module itself, which avoids holding the package binary open during Windows upgrades. Stop a running Runtime with `desic-okx stop` before upgrading.

Useful Runtime commands:

```bash
desic-okx status
desic-okx status --json
desic-okx doctor
desic-okx tools
desic-okx tool market_get_decision_snapshot
desic-okx stop
```

`status` shows the Runtime version, uptime, redacted proxy route, public/business/private WebSocket state, subscriptions and data ages, accounts, and database size. `doctor` performs active network, SQLite, market-data, account, MCP-client, Skill, and package checks. Both support machine-readable JSON.

## Connect Codex

The recommended option is `desic-okx setup`, which also installs all Skills. To register only the local stdio MCP server manually:

```bash
codex mcp add desic-okx -- desic-okx mcp
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.desic-okx]
command = "desic-okx"
args = ["mcp"]
```

## Connect Claude Code

The recommended option is `desic-okx setup`, which also installs all Skills. To register only the MCP server manually:

```bash
claude mcp add --transport stdio --scope user desic-okx -- desic-okx mcp
```

Verify the connection with:

```bash
claude mcp get desic-okx
```

A JSON example is available in `examples/claude-code/mcp.json`.

## Skills

`desic-okx setup` automatically installs all seven Skills for Codex and Claude Code. The MCP server exposes the tools; Skills add reusable analysis and trading workflows.

To install selected Skills manually, copy their directories from the installed package:

Codex personal skills:

```text
${CODEX_HOME:-~/.codex}/skills/<skill-name>/SKILL.md
```

Claude Code personal skills:

```text
~/.claude/skills/<skill-name>/SKILL.md
```

Project-scoped alternatives are `.agents/skills/` for Codex and `.claude/skills/` for Claude Code.

Included skills:

- `okx-market-analysis`
- `okx-derivatives-analysis`
- `okx-news-intelligence`
- `okx-smart-money-analysis`
- `okx-account-analysis`
- `okx-trading`
- `trading-philosophy`

Restart the client if a newly installed skill does not appear.

Setup synchronizes bundled Skills on every run. Identical Skills are left untouched. Changed copies are backed up before the bundled version is installed. They can also be inspected or synchronized explicitly:

```bash
desic-okx skills status
desic-okx skills sync
desic-okx skills sync --targets codex --dry-run
```

## Configure an OKX account

Public tools work without credentials. Account and trading tools use a named account alias and never accept credentials as tool arguments.

Add and verify an account interactively:

```bash
desic-okx account add --name demo --environment demo
desic-okx account verify --name demo
desic-okx account verify --all
desic-okx account list
desic-okx account set-default demo
desic-okx account rename demo demo-primary
desic-okx account edit demo-primary
```

`account add` and `account edit` verify the credentials with OKX before writing the configuration file. Editing credentials remains interactive so secrets are not passed as command-line arguments.

The credential prompts hide input. Credentials are stored in the system configuration directory in `config.json`; Unix permissions are set to `0600`. The active path is shown by:

```bash
desic-okx config-path
```

Environment variables can override a named account:

```text
OKX_ACCOUNT
OKX_API_KEY
OKX_API_SECRET
OKX_API_PASSPHRASE
OKX_ENVIRONMENT=demo|live
```

The three credential values must be provided together. Whether an account can trade is determined by the permissions assigned to its API key in OKX.

## Tool help

The MCP schemas are available to AI clients. Humans can inspect the same schema, account requirement, and a runnable example from the CLI:

```bash
desic-okx tool news_search
desic-okx tool trade_place_order --json
```

Remote News and Smart Money tools require a configured **live OKX account**. Read-only API permission is sufficient. Local News event and history tools can use previously persisted data where available. This requirement is included in the MCP tool descriptions and relevant Skills.

## Update

Check or install the latest npm release:

```bash
desic-okx update --check
desic-okx update
desic-okx update --yes
```

The updater checks the official npm registry, stops the Runtime, waits for the native SQLite module to be released, and then performs the global npm update. It synchronizes Skills for detected installations and runs Doctor afterward. When a newer CLI or MCP adapter encounters an older running Runtime, it automatically replaces it before handling requests.

## Proxy

REST and every public, business, and private WebSocket connection use the same proxy resolution order:

1. `proxy.url` in `config.json`
2. `HTTPS_PROXY`, `HTTP_PROXY`, or `ALL_PROXY` environment variables, with `NO_PROXY` support
3. The enabled Windows or macOS HTTP/HTTPS system proxy
4. Direct connection

Linux system-wide desktop proxy settings vary by distribution; use the standard environment variables or `config.json`. Only HTTP and HTTPS proxy URLs are supported. PAC-only and SOCKS-only system settings require an HTTP proxy endpoint.

Example explicit configuration:

```json
{
  "proxy": {
    "url": "http://127.0.0.1:7890"
  }
}
```

The guided `desic-okx setup` flow tests a manually entered proxy before saving it. See `examples/config.example.json` for a complete credential-free configuration template. Restart the Runtime after changing configuration.

## Runtime behavior

- Binds a random port on `127.0.0.1`
- Stores PID, port, and a random access token in private local state files
- Prewarms `BTC-USDT-SWAP` and `ETH-USDT-SWAP`
- Subscribes to other instruments on demand and releases them after 15 minutes of inactivity
- Serves fresh data from memory and uses REST for cold or stale data
- Reconnects WebSockets automatically
- Rebuilds the order book after sequence gaps or checksum failures
- Restores persisted candle and intelligence history before live prewarming

`market_get_decision_snapshot` combines market components around one observation time. It reports every component's exchange timestamp, receive time, age, warnings, and maximum observed time skew. Trading prechecks reject inconsistent snapshots.

## Trading behavior

Trading tools require a stable `executionKey`. Client order IDs are derived from that key, and execution state is recorded locally. When a write times out or returns an unclear result, the Runtime queries remote order state before deciding whether a retry is safe.

Supported order families include:

- `limit`
- `market`
- `post_only`
- `ioc`
- `fok`
- `trigger`
- `conditional`
- `trailing`

Ordinary and strategy orders are checked against instrument increments, minimum size, current account permission, and market snapshot consistency before submission.

Use an OKX Demo account first. Trading software can lose money, and the project provides no investment advice or guarantee of execution quality.

## Experimental intelligence

Remote News and Smart Money use upstream interfaces that may change without notice and require a configured live OKX account; read-only API permission is sufficient. Compatibility failures return `CAPABILITY_UNAVAILABLE`, or locally persisted history when available. A failure in these modules does not disable market, account, or trading tools.

## Development

```bash
npm ci
npm run check
```

The check pipeline runs:

- TypeScript type checking
- Unit tests
- Skill validation
- Sensitive-information scanning
- Production build
- MCP SDK smoke tests

The optional end-to-end trading test is restricted to OKX Demo. Export the four environment variables listed in the account section, using `demo` as the environment, and then run:

```bash
npm run test:demo
```

Normal tests never submit orders.

## Status

This repository is currently pre-release software at version `0.2.0`. Unit, packaging, Skill, and MCP transport checks are automated. Real OKX Demo trading should be validated in the target network environment before a `1.0.0` release.

## License

MIT. See `LICENSE`.

OKX and related marks belong to their respective owners.
