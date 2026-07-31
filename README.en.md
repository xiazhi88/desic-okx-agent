# Desic OKX Agent

[简体中文](README.md) | [English](README.en.md)

An independent local OKX Runtime, MCP server, CLI, and reusable agent Skills for Codex, Claude Code, and other MCP clients.

> [!IMPORTANT]
> Desic OKX Agent is an independent community project. It is not affiliated with, endorsed by, or an official product of OKX.

## Installation

Requires Node.js 22.12 or newer and network access to OKX, either directly or through an HTTP/HTTPS proxy.

First-time installation uses two commands:

```bash
npm install --global desic-okx-agent
desic-okx setup
```

The commands serve different purposes:

1. `npm install` installs the `desic-okx` program.
2. `desic-okx setup` connects AI clients, installs Skills, checks the network, and offers to configure an OKX API account.

Run `setup` once after the initial installation. Normal upgrades do not require it again. Run it again only to add an AI client, repair configuration, or change proxy settings.

Restart the selected AI clients after setup, then verify the installation:

```bash
desic-okx doctor
```

## What setup does

The interactive guide:

1. Lets you select Codex, Claude Code, Cursor, VS Code / GitHub Copilot, Cline, or all clients.
2. Registers the `desic-okx` MCP server without replacing existing MCP entries.
3. Installs all seven bundled Skills for Codex and Claude Code.
4. Checks OKX REST and WebSocket connectivity and guides you through testing and saving an HTTP proxy when needed.
5. Explains which features require an API key and lets you configure one now or skip it.
6. Masks credential input, automatically detects Live or Demo Trading, and saves the account only after successful verification.

An API account is optional. Public market and derivatives tools remain available when you skip this step. Configure an account later with:

```bash
desic-okx account add
```

For automation, select clients without opening the interactive guide. Non-interactive setup never requests or saves API credentials:

```bash
desic-okx setup --targets codex --yes
desic-okx setup --targets codex,claude-code --yes
desic-okx setup --all --yes
desic-okx setup --targets codex --yes --skip-network-check
```

## Configure an OKX API account

Create an API key in the official OKX website or app. Live and Demo Trading accounts use keys for their respective environments. Desic OKX Agent detects the environment through read-only verification, so the user does not select it.

Grant only the permissions needed for your use case:

| Capability | API key required | Requirement |
| --- | --- | --- |
| Public market data, candles, books, derivatives analysis | No | None |
| Balances, positions, orders, fills, and risk summaries | Yes | Read permission |
| Remote News and Smart Money | Yes | A `live` account; read permission is sufficient |
| Place, amend, cancel, close, and leverage operations | Yes | Trade permission on the OKX API key |

This project has no withdrawal, deposit, transfer, asset-movement, or API-key-management tools. Those permissions are not needed. Test trading workflows with an OKX Demo account first, and configure an IP allowlist in OKX according to your security policy.

Add an account interactively:

```bash
desic-okx account add --name demo
desic-okx account add --name main
```

API Key, Secret Key, and Passphrase input is hidden. `account add` verifies the credentials with OKX before writing them; failed verification saves nothing. Credentials are stored in `config.json` under the system configuration directory, with Unix permissions set to `0600`:

```bash
desic-okx config-path
```

Environment variables can override an account with the same name:

```text
OKX_ACCOUNT
OKX_API_KEY
OKX_API_SECRET
OKX_API_PASSPHRASE
```

All three credential variables must be provided together. The Runtime detects the account environment automatically. Trading availability is determined entirely by the permissions assigned to the API key in OKX.

## Ask an AI to install it

Paste this prompt into Codex, Claude Code, Cursor, VS Code / GitHub Copilot, or Cline. Replace `codex` with `claude-code`, `cursor`, `vscode`, `cline`, or `all` as appropriate.

```text
Install Desic OKX Agent for me:
1. Confirm Node.js is version 22.12 or newer.
2. Run npm install --global desic-okx-agent.
3. Run desic-okx setup --targets codex --yes.
4. Run desic-okx doctor to verify MCP, Skills, and OKX connectivity.
5. Never ask me to send an API Key, Secret, or Passphrase in chat.
6. Confirm that public tools are ready. If I need account, News, Smart Money, or trading features, guide me to run desic-okx account add in my own terminal and enter credentials into its hidden prompts.
```

## Quick start

Public market data does not require an account:

```bash
desic-okx call market_get_ticker --json '{"instId":"BTC-USDT-SWAP"}'
desic-okx call market_get_decision_snapshot --json '{"instId":"BTC-USDT-SWAP","bar":"1m"}'
```

The Runtime starts automatically on the first MCP or CLI call. Running `desic-okx start` manually is normally unnecessary.

Useful commands:

```bash
desic-okx status
desic-okx doctor
desic-okx tools
desic-okx tool market_get_decision_snapshot
desic-okx account list
desic-okx update --check
```

`status` reports Runtime version, uptime, proxy route, WebSocket state, subscriptions and data ages, accounts, and database state. `doctor` actively checks installation, network, SQLite, market data, accounts, MCP clients, and Skills. Both support `--json`.

## Main capabilities

- A shared singleton Runtime reused by multiple MCP and CLI clients
- In-memory ticker, order book, trades, candles, funding, mark price, and open-interest data
- Time-aligned decision snapshots with freshness, exchange timestamps, and consistency metadata
- Public market data, indicators, scanning, and public derivatives analysis
- Account balances, positions, orders, fills, bills, and risk summaries
- Ordinary orders, algo orders, leverage, amend, cancel, and close-position operations
- Experimental News and Smart Money capabilities with SQLite history fallback
- SQLite WAL persistence for closed candles, intelligence history, derived events, and execution records

## Skills

`desic-okx setup` automatically installs these for Codex and Claude Code:

- `okx-market-analysis`
- `okx-derivatives-analysis`
- `okx-news-intelligence`
- `okx-smart-money-analysis`
- `okx-account-analysis`
- `okx-trading`
- `trading-philosophy`

Skills are synchronized after upgrades. You can also inspect or synchronize them manually; modified copies are backed up first:

```bash
desic-okx skills status
desic-okx skills sync
desic-okx skills sync --targets codex --dry-run
```

## Account management

```bash
desic-okx account list
desic-okx account verify --name main
desic-okx account verify --all
desic-okx account set-default main
desic-okx account rename main primary
desic-okx account edit primary
desic-okx account remove primary
```

`account add` and `account edit` verify credentials before writing the configuration. Tool parameters accept account aliases only, never API Key, Secret, or Passphrase values.

## Tool help

```bash
desic-okx tools
desic-okx tool news_search
desic-okx tool trade_place_order
desic-okx tool trade_place_order --json
```

Help includes purpose, account requirements, input schema, and a runnable call example. Remote News and Smart Money interfaces are experimental. Upstream compatibility failures return `CAPABILITY_UNAVAILABLE` without disabling market, account, or trading modules.

## Proxy

REST and public, business, and private WebSocket connections use the same proxy resolution order:

1. `proxy.url` in `config.json`
2. `HTTPS_PROXY`, `HTTP_PROXY`, or `ALL_PROXY`, with `NO_PROXY` support
3. The enabled Windows or macOS HTTP/HTTPS system proxy
4. Direct connection

Only HTTP and HTTPS proxy URLs are supported. PAC-only and SOCKS-only environments need an HTTP proxy endpoint. Example:

```json
{
  "proxy": {
    "url": "http://127.0.0.1:7890"
  }
}
```

Stop the Runtime after changing configuration:

```bash
desic-okx stop
```

## Update

```bash
desic-okx update --check
desic-okx update
desic-okx update --yes
```

The updater checks the official npm registry, stops the Runtime, waits for Windows to release the native SQLite module, installs the global update, synchronizes installed Skills, and runs Doctor. A newer CLI or MCP adapter also replaces an older running Runtime automatically.

## Manual client setup

`desic-okx setup` is recommended. To register only the MCP server:

```bash
codex mcp add desic-okx -- desic-okx mcp
claude mcp add --transport stdio --scope user desic-okx -- desic-okx mcp
```

Manual Codex configuration:

```toml
[mcp_servers.desic-okx]
command = "desic-okx"
args = ["mcp"]
```

## Development from source

```bash
git clone https://github.com/xiazhi88/desic-okx-agent.git
cd desic-okx-agent
npm ci
npm run check
npm link
```

The check pipeline includes TypeScript type checking, unit tests, Skill validation, sensitive-information scanning, a production build, and an MCP transport smoke test. Normal tests never submit orders; real trading end-to-end tests are restricted to OKX Demo.

## Runtime behavior

- The Runtime binds a random `127.0.0.1` port and stores its PID, port, and access token in private state files.
- It prewarms `BTC-USDT-SWAP` and `ETH-USDT-SWAP`; other instruments are subscribed on demand and released after 15 idle minutes.
- Hot data is returned from memory. Cold or stale data is backfilled by REST.
- WebSockets reconnect automatically; the order book is rebuilt after sequence or checksum failures.
- `market_get_decision_snapshot` aligns components and reports their maximum time skew. Trading prechecks reject inconsistent snapshots.
- Trading writes use a stable `executionKey`. Ambiguous or timed-out writes query remote state before any retry.

Trading software can cause financial loss. This project provides no investment advice and makes no guarantee of execution results.

## Status and license

This is pre-release software at version `0.2.1`. OKX Demo trading should be validated in the target network environment before a `1.0.0` release.

MIT License. See `LICENSE`. OKX and related marks belong to their respective owners.
