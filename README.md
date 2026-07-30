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

## Install from GitHub

The npm package is not published yet. Install the current source version with:

```bash
git clone https://github.com/xiazhi88/desic-okx-agent.git
cd desic-okx-agent
npm ci
npm run build
npm link
```

This registers the `desic-okx` command on the local machine.

After the package is published to npm, installation will be:

```bash
npm install --global desic-okx-agent
```

## Quick start

Public market tools do not require an account:

```bash
desic-okx start
desic-okx call market_get_ticker --json '{"instId":"BTC-USDT-SWAP"}'
desic-okx call market_get_decision_snapshot --json '{"instId":"BTC-USDT-SWAP","bar":"1m"}'
```

The Runtime starts automatically when an MCP client or CLI call needs it. `desic-okx start` is optional.

Useful Runtime commands:

```bash
desic-okx status
desic-okx tools
desic-okx stop
```

## Connect Codex

Register the local stdio MCP server:

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

Register it for the current user:

```bash
claude mcp add --transport stdio --scope user desic-okx -- desic-okx mcp
```

Verify the connection with:

```bash
claude mcp get desic-okx
```

A JSON example is available in `examples/claude-code/mcp.json`.

## Install the skills

The MCP server exposes the tools. Skills add reusable analysis and trading workflows. Install only the skills you want by copying their directories from `skills/`.

Codex personal skills:

```text
~/.agents/skills/<skill-name>/SKILL.md
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

## Configure an OKX account

Public tools work without credentials. Account and trading tools use a named account alias and never accept credentials as tool arguments.

Add and verify an account interactively:

```bash
desic-okx account add --name demo --environment demo
desic-okx account verify --name demo
desic-okx account list
```

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

## Proxy

REST and WebSocket connections share the proxy configured in `config.json`:

```json
{
  "proxy": {
    "url": "http://127.0.0.1:7890"
  }
}
```

See `examples/config.example.json` for a complete credential-free configuration template. Restart the Runtime after changing configuration.

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

News and Smart Money use upstream interfaces that may change without notice. Compatibility failures return `CAPABILITY_UNAVAILABLE`, or locally persisted history when available. A failure in these modules does not disable market, account, or trading tools.

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

This repository is currently pre-release software at version `0.1.0`. Unit, packaging, Skill, and MCP transport checks are automated. Real OKX Demo trading should be validated in the target network environment before a `1.0.0` release.

## License

MIT. See `LICENSE`.

OKX and related marks belong to their respective owners.
