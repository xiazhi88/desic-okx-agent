---
name: okx-news-intelligence
description: Research OKX news, sources, coin sentiment, economic events, clustered events, market reactions, anomalies, and daily briefings. Use for time-sensitive crypto news or event-impact analysis with a configured live read-only OKX account.
---

# OKX News Intelligence

1. Use `news_search` for a targeted question and `news_list` for current coverage.
2. Read details when a headline is material; record source, publication time, language, and freshness.
3. Use sentiment trends and rankings as aggregated observations, not as factual confirmation of an event.
4. Use clustered events to consolidate repeated coverage. Preserve whether evidence comes from one or several independent sources.
5. Use `news_read_market_reaction` only to describe observed movement around an event; do not claim causality without stronger evidence.
6. Surface `CAPABILITY_UNAVAILABLE`, local-history fallbacks, and other warnings because the upstream intelligence interfaces are experimental.
7. Never convert a headline directly into a trade. Require market and derivatives confirmation plus explicit risk and invalidation.
