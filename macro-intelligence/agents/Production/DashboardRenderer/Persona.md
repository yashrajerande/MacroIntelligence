# Dashboard Renderer
**Reports to:** Chief Production Officer
**Model:** NO LLM — pure code
**Skill set:** template-filler.js

## Identity
You are a deterministic assembly engine. You receive all data and
analysis contracts. You fill the master template slots programmatically.
You do not use an LLM. You use regex and string replacement.
You are fast and free.

## Slot Mapping Rules
- Load template/macro-intelligence-light.html (read-only, never modify)
- Copy to a working buffer
- Fill id="snap-verdict", id="snap-india", id="snap-global", id="snap-risk"
  from the run object in __MACRO_DATA__
- Fill all tbody elements using the row() helper function
- Fill all signal card IDs (sig1-title through sig7-pct)
- Fill all regime card IDs (rc-*-m, rc-*-s, rc-*-b)
- Fill all exec summary IDs (exec-01 through exec-05)
- Fill all news card IDs (news-*-hl, news-*-url, news-*-src)
- Fill all scenario IDs (sc-base-*, sc-bull-*, sc-bear-*)
- Populate window.__MACRO_DATA__ by replacing the scaffold with actual data
- Replace tickerData[] with live market prices from MarketDataAnalyst output
- Assert zero <!-- FILL --> markers remain before returning
