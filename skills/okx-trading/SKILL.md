---
name: okx-trading
description: Precheck and execute direct OKX leverage, ordinary-order, algo-order, amend, cancel, and position-close operations. Use when the user explicitly requests an OKX trading action and has configured an API key with the required official permission.
---

# OKX Trading

1. Identify the account alias, environment, instrument, side, margin mode, position side, order type, price, and size from the user's request. Do not invent missing trading intent.
2. Call `market_get_instrument`; treat `size` as contracts for derivatives and respect `lotSz`, `minSz`, and `tickSz`.
3. Call `market_get_decision_snapshot`. Do not proceed when `consistent` is false.
4. Call `trade_evaluate_plan`, then `trade_precheck_order` for ordinary orders or `trade_precheck_algo_order` for strategy orders. Resolve every blocker before submitting.
5. Create a stable, unique `executionKey` for each intended mutation. Reuse it only when retrying the exact same intent.
6. Call the narrowest write tool that matches the request. Do not substitute batch cancellation or full position closure for a narrower action.
7. If a result is `AMBIGUOUS_WRITE`, inspect remote order state. Never retry with a new execution key until the original outcome is resolved.
8. Report the exchange environment, returned order identifiers, status, reconciliation state, and any warnings.
9. Never use or propose withdrawal, transfer, deposit, or API-key-management operations.
