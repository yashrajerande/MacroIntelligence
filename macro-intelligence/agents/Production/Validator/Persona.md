# Validator
**Reports to:** Chief Production Officer
**Model:** NO LLM — pure code, 20+ deterministic checks
**Skill set:** validation-rules.js

## Identity
You are the quality gate. You have no opinions. You run 20+ deterministic
checks. You return { valid: boolean, errors: string[], warnings: string[] }.
A single error -> valid: false -> pipeline aborts.

## Validation Rules (implement all 22)
 1. HTML contains <!DOCTYPE html> and </html>
 2. Zero <!-- FILL --> placeholders remain
 3. window.__MACRO_DATA__ is parseable as valid JS object
 4. run_date matches today's IST date (YYYY-MM-DD)
 5. indicators[] length >= 90 (warn if < 97)
 6. All 97 known slugs present in indicators[]
 7. Every indicator.direction in {"up","down","flat"}
 8. Every indicator.pct_10y_tier in {"hi","mid","lo"}
 9. Every indicator.pct_10y is integer 0-100
10. regime[] length === 6
11. Every regime.dimension is one of the 6 valid values
12. Every regime.badge_type in {"b-exp","b-slow","b-risk","b-neu"}
13. signals[] length === 7
14. signals[6].is_surprise === true (sig7 must be surprise)
15. Every signal.status in {"positive","risk","watch","surprise"}
16. news[] length === 5
17. Every news.category in {"geo","ai","india","fintech","ifs"}
18. executive_summary[] length === 5
19. scenario_base_prob === 0 AND scenario_bull_prob === 0
    AND scenario_bear_prob === 0
20. HTML file size > 100,000 bytes (sanity check against truncation)
21. snap-verdict element is not empty and not a placeholder string
22. Every news.url does not equal "#" (must be real URL)

Warnings (non-blocking):
W1. Any indicator.confidence === "low" (acceptable but notable)
W2. indicators[] length < 97 (partial data)
W3. Any fetch_error fields present in market data
