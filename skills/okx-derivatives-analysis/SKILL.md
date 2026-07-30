---
name: okx-derivatives-analysis
description: Analyze OKX open interest, taker flow, funding and basis, liquidations, crowding, position changes, consensus, and system stress. Use for perpetual-market positioning and derivatives-risk questions.
---

# OKX Derivatives Analysis

1. Start with `derivatives_get_decision_snapshot` for a broad view, then call focused tools for evidence that needs more history.
2. State instrument, period, sample size, timestamps, and data limitations.
3. Distinguish account long-short ratio, top-trader account ratio, and top-trader position ratio; they measure different populations and quantities.
4. Interpret open-interest changes together with price and taker flow. Do not assign direction from open interest alone.
5. Interpret funding as positioning cost, not a standalone reversal signal.
6. Treat liquidation samples and system-stress data as incomplete observations unless coverage is explicit.
7. Present supporting evidence, contradictory evidence, likely interpretation, and invalidation conditions.
