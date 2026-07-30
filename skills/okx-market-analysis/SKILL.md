---
name: okx-market-analysis
description: Analyze live OKX ticker, order book, trades, candles, funding, open interest, indicators, and time-aligned decision snapshots. Use for current market structure, liquidity, momentum, volatility, or watchlist analysis on OKX.
---

# OKX Market Analysis

1. Call `market_get_decision_snapshot` before combining multiple live market facts.
2. Check `consistent`, `maxTimeSkewMs`, component timestamps, and warnings. State that the snapshot is stale or inconsistent when applicable.
3. Use `market_get_instrument` before interpreting size, tick, lot, or contract value.
4. Use focused tools only when additional depth is needed: candles and indicators for trend, order book for current liquidity, recent trades for aggressive flow.
5. Separate closed candles from the active candle. Do not describe an active candle as final.
6. Report observed facts first, then interpretations, invalidation evidence, and limitations.
7. Never treat one indicator, one order-book snapshot, or one large trade as a sufficient trading signal.
