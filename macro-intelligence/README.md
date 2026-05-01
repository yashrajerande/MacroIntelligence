# MacroIntelligence Corp

A multi-agent AI pipeline that produces a Bloomberg Terminal-grade India & Global
Macro Dashboard every morning. 12 specialized agents, 8 data contracts, 97
indicators, 7 Supabase tables — fully autonomous on GitHub Actions.

## Architecture

```
GitHub Actions (06:00 IST daily)
       │
       ▼
┌──────────────────────────────────────────────────┐
│  CEO Orchestrator (agents/CEO/orchestrate.js)    │
│                                                  │
│  Step 1: DataIntelligence                        │
│    MarketDataAnalyst ─── Yahoo Finance + FRED    │
│    MacroDataAnalyst ──── Haiku + web_search      │
│    RealEstateAnalyst ─── Haiku + web_search      │
│                                                  │
│  Step 2: Analysis                                │
│    RegimeClassifier ──── Haiku (6 dimensions)    │
│    SignalDetector ─────── Sonnet (7 signals)     │
│    ScenarioPlanner ───── Haiku (3 scenarios)     │
│                                                  │
│  Step 3: Editorial                               │
│    NewsCurator ────────── Haiku + web_search     │
│    ExecSummaryWriter ─── Sonnet (5 paragraphs)   │
│                                                  │
│  Step 4: Production                              │
│    DashboardRenderer ─── Pure code (no LLM)      │
│    Validator ──────────── Pure code (22 checks)  │
│                                                  │
│  Step 5: Infrastructure                          │
│    SupabaseWriter ─────── REST API upserts       │
│    GitPublisher ────────── git commit + push     │
└──────────────────────────────────────────────────┘
       │                         │
       ▼                         ▼
   Supabase                  GitHub repo
   (7 tables)                (output/*.html)
```

## Setup

1. **Clone** the repository
2. **Install**: `cd macro-intelligence && npm ci`
3. **Configure secrets** in GitHub Actions (Settings → Secrets → Actions):

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Sonnet + Haiku |
| `SUPABASE_URL` | `https://djjnbnhboovacdyytrkz.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service_role key (server-side only) |
| `FRED_API_KEY` | FRED API key (free, stlouisfed.org) |
| `GH_PAT` | GitHub PAT with repo write scope |

4. **Add template**: Place `macro-intelligence-light.html` in `template/`
5. **Push** to GitHub. The daily cron runs at 00:30 UTC (06:00 IST).

## Manual Trigger

Go to Actions → "MacroIntelligence Corp — Manual Run" → Run workflow.

Options:
- `run_date`: Override date (YYYY-MM-DD)
- `skip_supabase`: Dry run without writing to database
- `skip_git_push`: Generate output without pushing to GitHub

Local dry run:
```bash
SKIP_SUPABASE=true SKIP_GIT_PUSH=true node agents/CEO/orchestrate.js
```

## Agent Registry

| # | Agent | Department | Role | Type | Model |
|---|---|---|---|---|---|
| 1 | **CEO** | Executive | Pipeline Orchestrator — coordinates all departments, enforces contracts, handles retries | Code + LLM | — |
| 2 | **MarketDataAnalyst** | DataIntelligence | Fetches real-time market prices from Yahoo Finance & FRED APIs | Code only | — |
| 3 | **MacroDataAnalyst** | DataIntelligence | 12 structured web searches for India & global macro indicators (CPI, GDP, PMI, GST, FII/DII, etc.) | LLM | Haiku |
| 4 | **RealEstateAnalyst** | DataIntelligence | Indian residential & commercial real estate data (Anarock, Knight Frank, JLL, RBI) | LLM | Haiku |
| 5 | **RegimeClassifier** | Analysis | Classifies macro regime across 6 dimensions with template-based narratives | Code only | — |
| 6 | **SignalDetector** | Analysis | Produces 7 signal cards with 10-year percentile scoring for capital allocators | LLM | Haiku |
| 7 | **ScenarioPlanner** | Analysis | Builds Base/Bull/Bear probability matrix via deterministic decision tree | Code only | — |
| 8 | **NewsCurator** | Editorial | RSS feeds (Reuters, ET, TechCrunch) + 1 Haiku call to refine headlines | LLM | Haiku |
| 9 | **ExecSummaryWriter** | Editorial | Dense 5-paragraph investment commentary for capital allocators | LLM | Sonnet |
| 10 | **DashboardRenderer** | Production | Assembles all data into the master HTML template via regex slot-filling | Code only | — |
| 11 | **VoiceBroadcaster** | Production | 60-second MP3 audio briefing: Haiku script + OpenAI TTS (onyx voice) | LLM + TTS | Haiku + OpenAI |
| 12 | **Validator** | Production | 22 deterministic checks + 6-layer reliability architecture (quality gate) | Code only | — |
| 13 | **SupabaseWriter** | Infrastructure | Upserts `__MACRO_DATA__` to 7 Supabase tables with merge-duplicates strategy | Code only | — |
| 14 | **GitPublisher** | Infrastructure | Commits & pushes validated dashboard HTML + MP3 to GitHub (with `[skip ci]`) | Code only | — |
| 15 | **ResearchAnalyst** | ConglomeratesTracker | Per-group evidence collection (capex, M&A, financing, leadership, regulatory) for last 30-60 days | LLM + web_search | Haiku |
| 16 | **StrategyAdvisor** | ConglomeratesTracker | Senior-partner synthesis: 7 core scores + 6 overlays + ranking + typology + red flags | LLM | Sonnet |
| 17 | **CriticReviewer** | ConglomeratesTracker | Stress-tests draft, gates publication, runs deterministic + LLM checks | LLM + Code | Sonnet |
| 18 | **Publisher (Conglomerates)** | ConglomeratesTracker | HTML render, Notion sub-page upsert, git commit/push | Code only | — |

**Execution order:** DataIntelligence → Analysis → Editorial → Production → Infrastructure

## ConglomeratesTracker (Monthly)
A separate department running once a month on the 1st. Produces a
strategic-power report on the top 21 Indian conglomerates. Output
publishes to GitHub Pages (as a tab on the MacroIntelligence root) and
to a Notion sub-page under the org page. See
`agents/ConglomeratesTracker/README.md` for details.

```bash
npm run conglomerates:test    # zero-cost pre-flight (14 assertions)
npm run conglomerates:dry-run # full cycle without git push
```

## Cost Estimate

| Agent | Model | Cost/Run |
|---|---|---|
| MarketDataAnalyst | No LLM (Yahoo/FRED APIs) | $0.00 |
| MacroDataAnalyst | Haiku + web_search | ~$0.02-0.04 |
| RealEstateAnalyst | Haiku + web_search | ~$0.01-0.02 |
| RegimeClassifier | No LLM (pure code) | $0.00 |
| SignalDetector | Haiku | ~$0.01-0.02 |
| ScenarioPlanner | No LLM (decision tree) | $0.00 |
| ExecutiveSummaryWriter | Sonnet | ~$0.03-0.05 |
| NewsCurator | RSS feeds + 1 Haiku call | ~$0.001 |
| **Total per run** | | **~$0.07-0.13** |
| **Monthly (30 runs)** | | **~$2.10-$3.90** |
| **Weekend/holiday runs** | Cached data, no fetch | **~$0.03-0.05** |

## Supabase Schema

**Version:** v1.0.0 (2026-03-24)

Tables: `dashboard_runs`, `macro_indicators`, `regime_classification`,
`signal_cards`, `news_feed`, `executive_summary`, `real_estate_summary`

All writes use upsert with `Prefer: resolution=merge-duplicates`.
Re-runs on the same date are idempotent.

## Troubleshooting

| Symptom | Check |
|---|---|
| Pipeline fails at DataIntelligence | Yahoo Finance may be blocking. Check `logs/*.json` for fetch errors. |
| Validation fails | Read the specific rule number in the error log. Most common: missing indicator slugs. |
| Supabase write fails | Verify `SUPABASE_SERVICE_KEY` is the service_role key (not anon). Check RLS policies. |
| Git push fails | Verify `GH_PAT` has repo write scope. Check if branch is protected. |
| LLM returns no JSON | Check Anthropic API status. The `<<<JSON>>>` extraction may need the raw response logged. |
| Cost higher than expected | Check `logs/*.json` for token counts per agent. Sonnet agents are the main cost. |

Failure logs are uploaded as GitHub Actions artifacts (7-day retention).
