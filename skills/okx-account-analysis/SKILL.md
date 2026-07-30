---
name: okx-account-analysis
description: Inspect configured OKX account balances, positions, pending orders, order history, fills, bills, account settings, and generic risk. Use for account-state, exposure, reconciliation, or risk-summary questions without changing exchange state.
---

# OKX Account Analysis

1. Select the requested account alias; use the configured default only when no account was specified.
2. Start with `account_get_snapshot` for current state, then use history, fills, or bills for reconciliation.
3. Report environment and account alias with every conclusion.
4. Distinguish equity, available balance, margin, notional exposure, realized results, and pending orders.
5. Treat empty data as an observed empty result only when no warning or upstream error is present.
6. Never request, print, infer, or return API credentials.
7. Do not call any `trade_*` tool while using this read-only analysis workflow.
