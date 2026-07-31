---
name: okx-trading
description: Precheck and execute direct OKX perpetual-swap leverage, ordinary-order, algo-order, amend, cancel, and position-close operations. Use when the user explicitly requests an OKX perpetual trading action and has configured an API key with the required official permission.
---

# OKX Trading

1. This workflow supports OKX perpetual swaps only. Require an `instId` ending in `-SWAP`; refuse spot, dated futures, options, and every other instrument type.
2. Identify the account alias, instrument, side, margin mode, position side, order type, price, and size from the user's request. Use the account environment detected by the Runtime; do not ask the user to classify the API key or invent missing trading intent.
3. Call `market_get_instrument`; treat `size` as contracts and respect `lotSz`, `minSz`, and `tickSz`.
4. Call `market_get_decision_snapshot`. Do not proceed when `consistent` is false.
5. Call `trade_evaluate_plan`, then `trade_precheck_order` for ordinary orders or `trade_precheck_algo_order` for strategy orders. Resolve every blocker before submitting.
6. Create a stable, unique `executionKey` for each intended mutation. Reuse it only when retrying the exact same intent.
7. Call the narrowest write tool that matches the request. Do not substitute batch cancellation or full position closure for a narrower action.
8. If a result is `AMBIGUOUS_WRITE`, inspect remote order state. Never retry with a new execution key until the original outcome is resolved.
9. Report the exchange environment, returned order identifiers, status, reconciliation state, and any warnings.
10. Never use or propose withdrawal, transfer, deposit, or API-key-management operations.
