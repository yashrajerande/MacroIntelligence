/**
 * ConglomeratesTracker — Department Orchestrator (monthly cadence).
 *
 * Workflow:
 *   1. Research  — ResearchAnalyst gathers per-group moves (web_search)
 *   2. Advise    — StrategyAdvisor scores + writes 13 sections
 *   3. Review    — CriticReviewer gates publication; one revision pass
 *   4. Publish   — Publisher renders HTML, updates root tab shell, commits
 *
 * Run manually:
 *   node agents/ConglomeratesTracker/orchestrate.js
 *
 * Idempotent: rerunning for the same month overwrites the archived
 * report at output/conglomerates/conglomerates-YYYY-MM.html.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { ResearchAnalyst } from './ResearchAnalyst/research.js';
import { StrategyAdvisor }  from './StrategyAdvisor/advise.js';
import { CriticReviewer }   from './CriticReviewer/review.js';
import { renderHTML }       from './Publisher/render.js';
import { publishGit }       from './Publisher/publishGit.js';
import { validateCycleOutput } from './skills/validate-cycle.js';
import { checkBudget, recordRunCost } from '../../src/utils/cost-ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPT_OUT = join(__dirname, '..', '..', 'output', 'conglomerates');
const STATE_PATH = join(DEPT_OUT, 'state.json');
const ROOT_INDEX = join(__dirname, '..', '..', '..', 'index.html');

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function computeCycle() {
  const override = process.env.CYCLE_OVERRIDE; // e.g. "2026-05"
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-indexed
  if (override) {
    const m = override.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      year = parseInt(m[1], 10);
      month = parseInt(m[2], 10) - 1;
    }
  }
  const isoMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  const cycleLabel = `${MONTHS[month]} ${year}`;

  // 30-60 day window: prior calendar month up to first of the run month.
  const windowEnd = new Date(Date.UTC(year, month, 1));
  const windowStart = new Date(Date.UTC(year, month - 1, 1));
  const fmt = d => d.toISOString().slice(0, 10);

  return {
    cycleLabel,
    isoMonth,
    windowStart: fmt(windowStart),
    windowEnd: fmt(windowEnd),
    runDate: now.toISOString().slice(0, 10),
  };
}

function loadPriorState() {
  try {
    if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch (err) {
    console.warn(`[Orchestrator] Could not load prior state: ${err.message}`);
  }
  return null;
}

function saveState(state) {
  mkdirSync(DEPT_OUT, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function buildRootIndex(cycleLabel, isoMonth) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MacroIntelligence</title>
<style>
:root{--ink:#0a0a14;--paper:#fafaf7;--muted:#6b6b78;--accent:#1a00cc;--rule:#e6e6e0;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'DM Mono',ui-monospace,monospace;height:100vh;display:flex;flex-direction:column;}
header{padding:14px 28px;border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:24px;flex-shrink:0;}
header h1{font-family:'Syne',ui-sans-serif,system-ui;font-weight:700;font-size:18px;letter-spacing:-0.01em;margin:0;color:var(--accent);}
nav{display:flex;gap:18px;font-family:'Syne',ui-sans-serif,system-ui;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;}
nav a{color:var(--muted);text-decoration:none;padding:6px 0;border-bottom:2px solid transparent;cursor:pointer;}
nav a.active{color:var(--accent);border-bottom-color:var(--accent);}
nav a:hover{color:var(--ink);}
.frame-wrap{flex:1;overflow:hidden;}
iframe{border:0;width:100%;height:100%;display:block;}
.cycle-tag{margin-left:auto;color:var(--muted);font-size:11px;}
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700&family=DM+Mono:wght@400;500&display=swap');
</style>
</head>
<body>
<header>
  <h1>MacroIntelligence</h1>
  <nav>
    <a id="tab-macro" class="active" data-src="macro-intelligence/output/index.html">Daily Macro</a>
    <a id="tab-cong"  data-src="macro-intelligence/output/conglomerates/index.html">Conglomerates</a>
  </nav>
  <span class="cycle-tag">Conglomerates cycle: ${cycleLabel}</span>
</header>
<div class="frame-wrap"><iframe id="frame" src="macro-intelligence/output/index.html"></iframe></div>
<script>
const tabs = document.querySelectorAll('nav a');
const frame = document.getElementById('frame');
tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  frame.src = t.dataset.src;
}));
</script>
</body>
</html>`;
}

async function withRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[Orchestrator] ${label} failed once: ${err.message}. Retrying in 5s.`);
    await new Promise(r => setTimeout(r, 5000));
    return await fn();
  }
}

function tokenCostUSD(tokens, model) {
  // Conservative public list-price approximation. Real cost is reconciled
  // post-run via Anthropic billing per Best Practice #4.
  const RATES = {
    'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },   // per 1M tokens
    'claude-sonnet-4-6':         { in: 3.0, out: 15.0 },
  };
  const r = RATES[model] || { in: 3.0, out: 15.0 };
  return ((tokens.input || 0) * r.in + (tokens.output || 0) * r.out) / 1_000_000;
}

async function run() {
  const cycle = computeCycle();
  console.log(`\n═══ ConglomeratesTracker · ${cycle.cycleLabel} ═══`);
  console.log(`Window: ${cycle.windowStart} → ${cycle.windowEnd}\n`);

  const startTs = Date.now();
  const meta = { cycle, agents: {} };

  try {
    // ── BUDGET GUARD (Best Practice #5) ─────────────────────────────
    const budget = checkBudget(cycle.runDate, 1.50); // est. monthly run cost ~$1.30
    console.log(
      `Budget: $${budget.month_spend_usd} spent / $${budget.budget_usd} cap · ` +
      `$${budget.remaining_usd} remaining`,
    );
    if (!budget.allowed) {
      console.error(`[Orchestrator] Monthly budget exceeded — aborting.`);
      process.exit(1);
    }

    // ── 1. RESEARCH (with per-cycle cache) ─────────────────────────
    // Phase 1 takes ~5min and ~$0.50-1 across 21 web_search calls. If a
    // later phase fails, we don't want the retry to redo all that work.
    // Cache findings to disk keyed by cycle; busted via FORCE_REFRESH.
    const researchCachePath = join(DEPT_OUT, `research-${cycle.isoMonth}.json`);
    let research;
    if (existsSync(researchCachePath) && process.env.FORCE_REFRESH !== 'true') {
      console.log(`── Phase 1: Research (cached) ──`);
      console.log(`  Loading ${researchCachePath} (set FORCE_REFRESH=true to re-fetch)`);
      research = JSON.parse(readFileSync(researchCachePath, 'utf-8'));
      console.log(
        `  ${research.data.findings.length} groups loaded · ` +
        `${research.data.findings.reduce((n, f) => n + (f.moves?.length || 0), 0)} moves`,
      );
    } else {
      console.log('── Phase 1: Research ──');
      research = await new ResearchAnalyst().research({
        windowStart: cycle.windowStart,
        windowEnd: cycle.windowEnd,
      });
      mkdirSync(DEPT_OUT, { recursive: true });
      writeFileSync(researchCachePath, JSON.stringify(research, null, 2));
      console.log(`  Cached to ${researchCachePath}`);
    }
    meta.agents.ResearchAnalyst = research.meta;

    // ── 2. ADVISE ──────────────────────────────────────────────────
    console.log('\n── Phase 2: Advise ──');
    const prior = loadPriorState();
    let advised = await withRetry(
      () => new StrategyAdvisor().advise({
        findings: research.data.findings,
        prior: prior?.data || null,
        cycleLabel: cycle.cycleLabel,
        windowStart: cycle.windowStart,
        windowEnd: cycle.windowEnd,
      }),
      'StrategyAdvisor',
    );
    meta.agents.StrategyAdvisor = advised.meta;

    // ── BOUNDARY VALIDATION (Best Practice #7) ─────────────────────
    let boundary = validateCycleOutput(advised.data);
    if (!boundary.valid) {
      console.warn('[Orchestrator] Boundary validation failed:');
      for (const e of boundary.errors) console.warn(`  · ${e}`);
      // Treat as a critic-blocker — request a structured revision before review.
      const fixHints = `Boundary validation found these structural failures. Fix them in the next emit:\n- ${boundary.errors.join('\n- ')}`;
      advised = await withRetry(
        () => new StrategyAdvisor().advise({
          findings: research.data.findings,
          prior: prior?.data || null,
          cycleLabel: cycle.cycleLabel,
          windowStart: cycle.windowStart,
          windowEnd: cycle.windowEnd,
          critique: fixHints,
        }),
        'StrategyAdvisor (boundary-fix)',
      );
      meta.agents.StrategyAdvisor_boundary_fix = advised.meta;
      boundary = validateCycleOutput(advised.data);
      if (!boundary.valid) {
        console.error('[Orchestrator] Boundary validation still failing — aborting.');
        for (const e of boundary.errors) console.error(`  · ${e}`);
        process.exit(1);
      }
    }

    // ── 3. REVIEW (with one revision pass) ────────────────────────
    console.log('\n── Phase 3: Review ──');
    let review = await new CriticReviewer().review({
      draft: advised.data,
      cycleLabel: cycle.cycleLabel,
    });
    meta.agents.CriticReviewer_pass1 = review.meta;

    if (review.data.verdict === 'REVISE') {
      console.log('[Orchestrator] REVISE — running one Advisor revision pass.');
      const critique = `${review.data.suggested_fixes || ''}\n\nBlockers:\n- ${(review.data.blockers || []).join('\n- ')}`;
      advised = await new StrategyAdvisor().advise({
        findings: research.data.findings,
        prior: prior?.data || null,
        cycleLabel: cycle.cycleLabel,
        windowStart: cycle.windowStart,
        windowEnd: cycle.windowEnd,
        critique,
      });
      meta.agents.StrategyAdvisor_revision = advised.meta;

      review = await new CriticReviewer().review({
        draft: advised.data,
        cycleLabel: cycle.cycleLabel,
      });
      meta.agents.CriticReviewer_pass2 = review.meta;

      if (review.data.verdict !== 'PASS') {
        console.error('[Orchestrator] Revision still REVISE. Aborting publish.');
        console.error('Blockers:', JSON.stringify(review.data.blockers, null, 2));
        process.exit(1);
      }
    }

    // ── 4. PUBLISH ────────────────────────────────────────────────
    console.log('\n── Phase 4: Publish ──');

    const rendered = renderHTML({
      data: advised.data,
      cycleLabel: cycle.cycleLabel,
      runDate: cycle.runDate,
      isoMonth: cycle.isoMonth,
    });
    console.log(`[Publisher/HTML] ${rendered.archivePath} (${rendered.sizeBytes} bytes)`);

    // Update root tab shell
    writeFileSync(ROOT_INDEX, buildRootIndex(cycle.cycleLabel, cycle.isoMonth));
    console.log(`[Publisher/HTML] Root tab shell updated: ${ROOT_INDEX}`);

    // Persist state for next cycle's delta
    saveState({
      cycle,
      data: advised.data,
      review: review.data,
      meta,
    });

    // Git (skip if env says so)
    const gitResult = publishGit({
      archivePath: rendered.archivePath,
      latestPath:  rendered.latestPath,
      rootIndexPath: ROOT_INDEX,
      cycleLabel: cycle.cycleLabel,
      dryRun: process.env.SKIP_GIT_PUSH === 'true',
    });

    // ── COST RECORDING (Best Practice #4) ──────────────────────────
    const totalCost = Object.values(meta.agents).reduce((sum, m) => {
      if (!m?.tokens || !m?.model) return sum;
      return sum + tokenCostUSD(m.tokens, m.model);
    }, 0);
    recordRunCost(cycle.runDate, totalCost, `congs-${cycle.isoMonth}`);

    const totalMs = Date.now() - startTs;
    console.log(`\n═══ Cycle ${cycle.cycleLabel} complete in ${(totalMs / 1000).toFixed(1)}s ═══`);
    console.log(`  HTML:   ${rendered.latestPath}`);
    console.log(`  Git:    ${gitResult?.sha || gitResult?.reason || (gitResult?.skipped ? 'skipped' : '—')}`);
    console.log(`  Cost:   $${totalCost.toFixed(4)} (estimate — verify against Anthropic billing)`);
    process.exit(0);
  } catch (err) {
    console.error(`[Orchestrator] Failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

run();
