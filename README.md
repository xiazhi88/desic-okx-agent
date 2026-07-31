# Desic OKX Agent

[简体中文](README.md) | [English](README.en.md)

面向 Codex、Claude Code 及其他 MCP 客户端的独立 OKX 本地 Runtime、MCP Server、CLI 和 Agent Skills。

> [!IMPORTANT]
> Desic OKX Agent 是独立的社区项目，并非 OKX 官方产品，也未获得 OKX 的认可或背书。

## 安装

要求 Node.js 22.12 或更高版本，以及能够访问 OKX 的网络或 HTTP/HTTPS 代理。

首次安装只需两条命令：

```bash
npm install --global desic-okx-agent
desic-okx setup
```

两条命令作用不同：

1. `npm install` 安装 `desic-okx` 程序。
2. `desic-okx setup` 接入 AI 客户端、安装 Skills、检查网络，并询问是否配置 OKX API 账户。

首次安装后需要运行一次 `setup`。以后正常升级无需重复运行；只有新增 AI 客户端、修复配置或重新配置代理时才需要再次运行。

完成后重启已选择的 AI 客户端，并验证：

```bash
desic-okx doctor
```

## Setup 会做什么

交互式向导会依次完成：

1. 选择 Codex、Claude Code、Cursor、VS Code / GitHub Copilot、Cline，或全部客户端。
2. 注册 `desic-okx` MCP Server，保留已有 MCP 配置。
3. 为 Codex 和 Claude Code 自动安装全部 7 个 Skills。
4. 检查 OKX REST 与 WebSocket；连接失败时引导测试并保存 HTTP 代理。
5. 解释不同功能的 API Key 要求，并让用户选择“现在配置”或“以后配置”。
6. 如果现在配置，隐藏凭证输入，先向 OKX 验证，成功后才写入本地配置。

API 账户是可选的。跳过后公共行情和公共衍生品仍可使用，以后运行下面的命令即可配置：

```bash
desic-okx account add
```

自动化或无人值守安装可以指定客户端；该模式不会询问或保存 API 凭证：

```bash
desic-okx setup --targets codex --yes
desic-okx setup --targets codex,claude-code --yes
desic-okx setup --all --yes
desic-okx setup --targets codex --yes --skip-network-check
```

## 配置 OKX API

在 OKX 官方网站或 App 中创建 API Key。实盘账户与模拟交易账户使用各自环境的 API Key；在向导中必须选择对应的 `live` 或 `demo` 环境。

按实际用途授予权限：

| 功能 | 是否需要 API Key | 所需条件 |
| --- | --- | --- |
| 公共行情、K 线、盘口、衍生品分析 | 否 | 无 |
| 余额、持仓、订单、成交、风险摘要 | 是 | 读取权限 |
| 远程 News、Smart Money | 是 | `live` 账户，读取权限即可 |
| 下单、改单、撤单、平仓、设置杠杆 | 是 | OKX API Key 具备交易权限 |

本项目不提供提现、充值、资金划转、资产转出或 API Key 管理工具，不需要为此授予相关权限。建议先使用 OKX 模拟交易账户验证交易流程，并按自己的安全策略在 OKX 配置 IP 白名单。

交互式添加账户：

```bash
desic-okx account add --name demo --environment demo
desic-okx account add --name main --environment live
```

输入 API Key、Secret Key 和 Passphrase 时终端会隐藏文本。`account add` 会先连接 OKX 验证，验证失败不会保存凭证。凭证保存在系统配置目录的 `config.json` 中；Unix 权限为 `0600`：

```bash
desic-okx config-path
```

也支持环境变量覆盖同名账户：

```text
OKX_ACCOUNT
OKX_API_KEY
OKX_API_SECRET
OKX_API_PASSPHRASE
OKX_ENVIRONMENT=demo|live
```

三个凭证变量必须同时提供。能否交易完全取决于 OKX 为该 API Key 配置的官方权限。

## 让 AI 自动安装

可将下面的提示词交给 Codex、Claude Code、Cursor、VS Code / GitHub Copilot 或 Cline。将 `codex` 替换为 `claude-code`、`cursor`、`vscode`、`cline` 或 `all`：

```text
请为我安装 Desic OKX Agent：
1. 检查 Node.js 是否为 22.12 或更高版本。
2. 运行 npm install --global desic-okx-agent。
3. 运行 desic-okx setup --targets codex --yes。
4. 运行 desic-okx doctor 验证 MCP、Skills 和 OKX 网络。
5. 不要要求我在聊天中发送任何 API Key、Secret 或 Passphrase。
6. 告诉我公共工具已可使用；如果我需要账户、News、Smart Money 或交易功能，引导我直接在自己的终端运行 desic-okx account add，并由我在隐藏输入框中填写凭证。
```

## 快速开始

公共行情不需要账户：

```bash
desic-okx call market_get_ticker --json '{"instId":"BTC-USDT-SWAP"}'
desic-okx call market_get_decision_snapshot --json '{"instId":"BTC-USDT-SWAP","bar":"1m"}'
```

Runtime 会在 MCP 或 CLI 首次调用时自动启动，通常不需要手动运行 `desic-okx start`。

常用命令：

```bash
desic-okx status
desic-okx doctor
desic-okx tools
desic-okx tool market_get_decision_snapshot
desic-okx account list
desic-okx update --check
```

`status` 显示 Runtime 版本、运行时间、代理路径、WebSocket 状态、订阅与数据年龄、账户和数据库状态。`doctor` 主动检查安装、网络、SQLite、行情、账户、MCP 客户端和 Skills。两者均支持 `--json`。

## 主要能力

- 共享单例 Runtime，可被多个 MCP 和 CLI 客户端复用
- 内存中的 ticker、盘口、逐笔成交、K 线、资金费率、标记价格和持仓量
- 带新鲜度、交易所时间和一致性元数据的统一决策快照
- 公共行情、指标扫描和公共衍生品分析
- 账户余额、持仓、委托、成交、账单及风险摘要
- 普通单、策略单、杠杆、改单、撤单和平仓操作
- 实验性的 News 与 Smart Money 能力，以及 SQLite 历史回退
- SQLite WAL 持久化已收盘 K 线、情报历史、派生事件和执行记录

## Skills

`desic-okx setup` 会为 Codex 和 Claude Code 自动安装：

- `okx-market-analysis`
- `okx-derivatives-analysis`
- `okx-news-intelligence`
- `okx-smart-money-analysis`
- `okx-account-analysis`
- `okx-trading`
- `trading-philosophy`

升级后 Skills 会自动同步。也可手动检查或同步；被修改的旧版本会先备份：

```bash
desic-okx skills status
desic-okx skills sync
desic-okx skills sync --targets codex --dry-run
```

## 账户管理

```bash
desic-okx account list
desic-okx account verify --name main
desic-okx account verify --all
desic-okx account set-default main
desic-okx account rename main primary
desic-okx account edit primary
desic-okx account remove primary
```

`account add` 和 `account edit` 均在写入配置前验证凭证。工具参数只接受账户别名，不接受 API Key、Secret 或 Passphrase。

## 工具帮助

```bash
desic-okx tools
desic-okx tool news_search
desic-okx tool trade_place_order
desic-okx tool trade_place_order --json
```

帮助会显示用途、账户要求、输入 Schema 和可直接运行的调用示例。远程 News 与 Smart Money 接口属于实验性能力，上游兼容性问题会返回 `CAPABILITY_UNAVAILABLE`，不会影响行情、账户和交易模块。

## 代理

REST 以及公共、业务和私有 WebSocket 统一按以下顺序解析代理：

1. `config.json` 中的 `proxy.url`
2. `HTTPS_PROXY`、`HTTP_PROXY` 或 `ALL_PROXY`，并支持 `NO_PROXY`
3. Windows 或 macOS 已启用的系统 HTTP/HTTPS 代理
4. 直接连接

只支持 HTTP/HTTPS 代理 URL。仅有 PAC 或 SOCKS 的环境需要提供 HTTP 代理入口。示例：

```json
{
  "proxy": {
    "url": "http://127.0.0.1:7890"
  }
}
```

修改配置后重启 Runtime：

```bash
desic-okx stop
```

## 更新

```bash
desic-okx update --check
desic-okx update
desic-okx update --yes
```

更新器会检查 npm 官方 Registry、停止 Runtime、等待 Windows 释放 SQLite 原生模块、执行全局升级、同步已安装 Skills，最后运行 Doctor。新版 CLI 或 MCP 适配器遇到旧 Runtime 时也会自动切换版本。

## 手动接入客户端

推荐使用 `desic-okx setup`。只注册 MCP 时，可运行：

```bash
codex mcp add desic-okx -- desic-okx mcp
claude mcp add --transport stdio --scope user desic-okx -- desic-okx mcp
```

Codex 的手动配置：

```toml
[mcp_servers.desic-okx]
command = "desic-okx"
args = ["mcp"]
```

## 从源码开发

```bash
git clone https://github.com/xiazhi88/desic-okx-agent.git
cd desic-okx-agent
npm ci
npm run check
npm link
```

检查流程包含 TypeScript 类型检查、单元测试、Skill 校验、敏感信息扫描、生产构建和 MCP 传输冒烟测试。普通测试不会提交订单；真实交易端到端测试仅允许 OKX Demo 环境。

## 运行机制

- Runtime 绑定 `127.0.0.1` 随机端口，并以私有状态文件保存 PID、端口和访问令牌。
- 默认预热 `BTC-USDT-SWAP` 和 `ETH-USDT-SWAP`，其他合约按需订阅并在空闲 15 分钟后释放。
- 热数据从内存返回，冷数据或过期数据由 REST 补齐。
- WebSocket 自动重连；盘口序列、校验失败时重新建立快照。
- `market_get_decision_snapshot` 对齐多个数据组件并报告最大时间偏差；交易预检拒绝不一致快照。
- 交易写操作使用稳定 `executionKey`。超时或结果不明确时先查询远端状态，不直接重复提交。

交易软件可能造成资金损失。本项目不提供投资建议，也不保证执行结果。

## 状态与许可

当前为 `0.2.1` 预发布版本。正式发布 `1.0.0` 前，应在目标网络环境中完成 OKX Demo 交易验证。

MIT License，详见 `LICENSE`。OKX 及相关商标归其各自权利人所有。
