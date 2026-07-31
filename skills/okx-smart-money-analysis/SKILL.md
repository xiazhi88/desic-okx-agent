---
name: okx-smart-money-analysis
description: Analyze OKX public trader rankings, performance, positions, histories, and Smart Money signal trends. Use to compare trader cohorts or investigate positioning with a configured live read-only OKX account.
---

# OKX Smart Money Analysis

Remote Smart Money tools require a configured live OKX account. Read-only API permission is sufficient. Local history is available only after data has previously been persisted.

1. Define the period, sort field, filters, and sample size before comparing traders.
2. Use performance to shortlist; inspect current positions and history before interpreting behavior.
3. Separate current positions, closed-position history, public order history, signal overview, and signal trend.
4. Check whether results were refreshed remotely or returned from local history, and report limitations.
5. Surface `CAPABILITY_UNAVAILABLE` and compatibility warnings because the upstream interfaces are experimental.
6. Compare several traders or a defined cohort. Do not generalize from one account.
7. Look for disagreement between performance, current exposure, derivatives flow, and price action.
8. Do not blindly copy positions or imply that past ranking predicts future returns.
