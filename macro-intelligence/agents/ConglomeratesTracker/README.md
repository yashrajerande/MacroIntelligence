# ConglomeratesTracker — Department

Monthly intelligence cycle on India's top 21 conglomerates. Not a news
digest. A comparative power map: who is gaining, who is losing, who is
fragile, who will dominate the next decade.

## Universe (fixed)
**Core (10):** Reliance, Tata, Adani, Aditya Birla, Mahindra, L&T, Bharti,
JSW, Bajaj, Vedanta.
**Bench (11):** Murugappa, TVS, Sundaram, Godrej, Hero, Hinduja, RPG,
Shapoorji Pallonji, Essar, Welspun, Piramal.

## Workflow
```
Research  →  Advise  →  Review  →  Publish
   │           │          │          │
   ▼           ▼          ▼          ▼
Haiku +    Sonnet     Sonnet +    HTML +
web_search synthesis  determ.     Notion +
                      checks      Git
```

| # | Agent | Role | Type | Model |
|---|---|---|---|---|
| 1 | **ResearchAnalyst** | Per-group evidence collection (capex, M&A, financing, leadership, regulatory) for the last 30-60 days | LLM + web_search | Haiku |
| 2 | **StrategyAdvisor** | Senior-partner synthesis: 7 core scores + 6 overlays + ranking + typology + red flags + themes | LLM | Sonnet |
| 3 | **CriticReviewer** | Stress-tests the draft. Universe coverage, banned-phrase scan, score reconciliation. Gates publish | LLM + code | Sonnet |
| 4 | **Publisher** | HTML render, Notion sub-page upsert, git commit/push. Pure code | Code | — |

## Cadence
- Cron: 00:30 UTC on the 1st of every month (06:00 IST).
- Manual: GitHub Actions → "ConglomeratesTracker - Monthly Run" → Run workflow.

## Outputs
1. **HTML report** — `macro-intelligence/output/conglomerates/conglomerates-YYYY-MM.html`
   (archive) and `…/conglomerates/index.html` (latest).
2. **MacroIntelligence root tab** — `index.html` ships a tabbed shell with
   "Daily Macro" and "Conglomerates" tabs over the same domain.
3. **Notion** — sub-page under the MacroIntelligence org page titled
   `Conglomerates Tracker — <Month> <Year>` with native tables and callouts.

## State & Idempotency
The Advisor's output for each cycle is persisted to
`output/conglomerates/state.json`. The next cycle reads it as the prior
scorecard so deltas are real and not invented. Re-running the same month
overwrites the archive HTML and archives-and-recreates the Notion page.

## Required Secrets
| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Sonnet + Haiku |
| `NOTION_API_KEY` | Internal integration token (Notion → Settings → Connections) |
| `NOTION_PARENT_PAGE_ID` | Page ID of the MacroIntelligence org page in Notion |
| `GH_PAT` | Repo write scope for the auto-commit |

## Cost Estimate (per monthly run)
| Phase | Calls | Approx Cost |
|---|---|---|
| ResearchAnalyst (21 × Haiku + web_search) | 21 | $0.40-1.00 |
| StrategyAdvisor (Sonnet, ~6k input) | 1-2 | $0.05-0.15 |
| CriticReviewer (Sonnet, deterministic + LLM) | 1-2 | $0.03-0.10 |
| **Total per month** | — | **~$0.50-1.30** |

## Local Dry Run
```bash
cd macro-intelligence
SKIP_GIT_PUSH=true CYCLE_OVERRIDE=2026-05 npm run conglomerates:dry-run
```

## Best-Practices Compliance
This department was built from the start against the lessons in
*MacroIntelligence Corp · Best Practices & Principles* (Notion):

| # | Principle | Implementation |
|---|---|---|
| 1 | Single source of truth | `skills/universe.js`, `skills/scoring-framework.md` |
| 2 | LLM for judgment, code for logic | `skills/validate-cycle.js` deterministic checks |
| 5 | Budget guards non-negotiable | `checkBudget()` at orchestrator entry |
| 6 | Hard rules fire first | Boundary validator before CriticReviewer |
| 7 | Validate at boundary, trust internally | `validateCycleOutput()` between Advisor and Publisher |
| 8 | Pre-flight at zero cost | `npm run conglomerates:test` (14 assertions, no API calls) |
| 9 | Persona is product | Three-voice personas with banned-phrase lists |
| 11 | Non-blocking for non-critical | Notion publish wrapped in try/catch; Git is critical |
| 14 | Workflow location & git hygiene | `.github/workflows/` at repo root |
| 17 | Dedup at every layer | Notion archive-and-recreate; Git skips no-op commits |

## Troubleshooting
| Symptom | Fix |
|---|---|
| CriticReviewer fails twice | Inspect `output/conglomerates/state.json` for the rejected draft and the blockers array. Most common: missing groups in a table. |
| Notion publish skipped | `NOTION_API_KEY` or `NOTION_PARENT_PAGE_ID` missing. Add to repo secrets. |
| Empty moves table | The cycle was genuinely quiet. Check ResearchAnalyst logs — if every group returned `no_material_movement: true`, the report is correct. |
| Tab nav 404 on first run | First cron hasn't run yet. The placeholder at `output/conglomerates/index.html` ships pre-seeded so the link resolves. |
