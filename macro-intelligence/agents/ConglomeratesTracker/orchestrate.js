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
import { randomUUID } from 'crypto';
import { checkBudget, recordRunCost, LEDGER_PATH } from '../../src/utils/cost-ledger.js';
import { meter } from '../../src/utils/usage-meter.js';
import { journalPathFor } from '../../src/utils/persist-cost-ledger.js';
import { sendFailureAlert, currentRunUrl } from '../../src/utils/resilience.js';

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
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700&family=DM+Mono:wght@400;500&display=swap');
:root{--ink:#0a0a14;--paper:#fafaf7;--muted:#6b6b78;--accent:#1a00cc;--rule:#e6e6e0;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'DM Mono',ui-monospace,monospace;height:100vh;display:flex;flex-direction:column;}
/* flex-wrap + nowrap tabs: the header had no wrap rule, so on a phone the
   nav was squeezed and "Conglomerates" was pushed off the right edge of
   the screen — the tab existed but was invisible. Keep in sync with the
   committed root index.html (this generator overwrites it every cycle). */
header{padding:12px 16px;border-bottom:1px solid var(--rule);display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;flex-shrink:0;min-width:0;}
header h1{font-family:'Syne',ui-sans-serif,system-ui;font-weight:700;font-size:18px;letter-spacing:-0.01em;margin:0;color:var(--accent);white-space:nowrap;}
nav{display:flex;gap:18px;font-family:'Syne',ui-sans-serif,system-ui;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0;}
nav a{color:var(--muted);text-decoration:none;padding:6px 0;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;}
nav a.active{color:var(--accent);border-bottom-color:var(--accent);}
nav a:hover{color:var(--ink);}
.frame-wrap{flex:1;overflow:hidden;}
iframe{border:0;width:100%;height:100%;display:block;}
.cycle-tag{margin-left:auto;color:var(--muted);font-size:11px;white-space:nowrap;}
@media (max-width:640px){ .cycle-tag{display:none;} header{padding:10px 12px;} }
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
const initial = new URL(location.href).searchParams.get('tab');
if (initial === 'conglomerates') {
  tabs.forEach(x => x.classList.remove('active'));
  document.getElementById('tab-cong').classList.add('active');
  frame.src = 'macro-intelligence/output/conglomerates/index.html';
}
tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  frame.src = t.dataset.src;
  const which = t.id === 'tab-cong' ? 'conglomerates' : 'macro';
  history.replaceState({}, '', '?tab=' + which);
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

// Ledger details from the usage meter. Every Anthropic response in this
// process (incl. failed/retried/partial ones and web searches) was charged
// at the response boundary; research served from the cycle cache costs
// nothing this run (the old token sum re-charged the cached tokens).
function costDetails(status) {
  const s = meter.summary();
  return {
    status,
    pipeline: 'conglomerates',
    cost_complete: s.cost_complete,
    unknown_usage_calls: s.unknown_usage_calls,
    partial_calls: s.partial_calls,
    calls: s.calls,
    usage: {
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      cache_creation_5m_input_tokens: s.cache_creation_5m_input_tokens,
      cache_creation_1h_input_tokens: s.cache_creation_1h_input_tokens,
      cache_read_input_tokens: s.cache_read_input_tokens,
      web_search_requests: s.web_search_requests,
    },
  };
}

async function run() {
  const cycle = computeCycle();
  console.log(`\n═══ ConglomeratesTracker · ${cycle.cycleLabel} ═══`);
  console.log(`Window: ${cycle.windowStart} → ${cycle.windowEnd}\n`);

  const startTs = Date.now();
  const meta = { cycle, agents: {} };

  // One run_id per process attempt (it used to be the fixed
  // `congs-YYYY-MM`). The ledger upserts by run_id, so a fixed id would
  // let a same-month re-run overwrite a failed attempt's real spend.
  const runId = `congs-${cycle.isoMonth}-${randomUUID().slice(0, 8)}`;
  meter.attachRun({ runId, isoDate: cycle.runDate, pipeline: 'conglomerates', journalPath: journalPathFor(runId) });

  // Every abort path charges the ledger (idempotent per run_id). The
  // workflow's "Persist cost ledger" step then makes it durable on main.
  const recordCostOnFailure = () => {
    if (meter.summary().calls === 0) return;
    try {
      recordRunCost(cycle.runDate, meter.summary().cost_usd, runId, undefined, costDetails('failed'));
    } catch { /* best-effort on the failure path */ }
  };
  const abort = () => { recordCostOnFailure(); process.exit(1); };

  try {
    // ── BUDGET GUARD (Best Practice #5) ─────────────────────────────
    const budget = checkBudget(cycle.runDate, 1.50); // est. monthly run cost ~$1.30
    console.log(
      `Budget: $${budget.month_spend_usd} spent / $${budget.budget_usd} cap · ` +
      `$${budget.remaining_usd} remaining`,
    );
    if (!budget.allowed) {
      console.error(`[Orchestrator] Monthly budget exceeded — aborting.`);
      // This shares output/cost-ledger.json's $5/month cap with the daily
      // CEO pipeline — a console.error on a monthly cron nobody tails is
      // exactly the "silently blocked for days" shape the 31 OCT 2026
      // incident was. CEO's budget guard alerts; this one didn't.
      await sendFailureAlert({
        dateStr: cycle.cycleLabel,
        kind: 'budget',
        reason: `Monthly spend $${budget.month_spend_usd} exceeds $${budget.budget_usd} cap (shared with the daily dashboard pipeline)`,
        runUrl: currentRunUrl(),
        phase: 'Budget guard',
      });
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
      const boundaryDraft = advised.data;
      advised = await withRetry(
        () => new StrategyAdvisor().advise({
          findings: research.data.findings,
          prior: prior?.data || null,
          cycleLabel: cycle.cycleLabel,
          windowStart: cycle.windowStart,
          windowEnd: cycle.windowEnd,
          critique: fixHints,
          previousDraft: boundaryDraft,
        }),
        'StrategyAdvisor (boundary-fix)',
      );
      meta.agents.StrategyAdvisor_boundary_fix = advised.meta;
      boundary = validateCycleOutput(advised.data);
      if (!boundary.valid) {
        console.error('[Orchestrator] Boundary validation still failing — aborting.');
        for (const e of boundary.errors) console.error(`  · ${e}`);
        abort();
      }
    }

    // ── 3. REVIEW (with up to MAX_REVISIONS revision passes) ──────
    // One pass proved too tight in practice: a strict critic reliably
    // finds a second round of smaller issues in the first revision.
    // Two passes converge; if the third review still blocks, the cycle
    // has a real quality problem and aborting is correct.
    const MAX_REVISIONS = 2;
    console.log('\n── Phase 3: Review ──');
    let review = await new CriticReviewer().review({
      draft: advised.data,
      cycleLabel: cycle.cycleLabel,
    });
    meta.agents.CriticReviewer_pass1 = review.meta;

    for (let rev = 1; review.data.verdict === 'REVISE' && rev <= MAX_REVISIONS; rev++) {
      console.log(`[Orchestrator] REVISE — Advisor revision pass ${rev}/${MAX_REVISIONS}.`);
      const critique = `${review.data.suggested_fixes || ''}\n\nBlockers:\n- ${(review.data.blockers || []).join('\n- ')}`;
      const revisionBase = advised.data;
      const priorBlockers = review.data.blockers || [];
      advised = await new StrategyAdvisor().advise({
        findings: research.data.findings,
        prior: prior?.data || null,
        cycleLabel: cycle.cycleLabel,
        windowStart: cycle.windowStart,
        windowEnd: cycle.windowEnd,
        critique,
        previousDraft: revisionBase,
      });
      meta.agents[`StrategyAdvisor_revision${rev}`] = advised.meta;

      review = await new CriticReviewer().review({
        draft: advised.data,
        cycleLabel: cycle.cycleLabel,
        priorBlockers,
      });
      meta.agents[`CriticReviewer_pass${rev + 1}`] = review.meta;
    }

    // ── RED-PEN FALLBACK ──────────────────────────────────────────
    // September 2026 deadlocked here: one concrete blocker survived both
    // Advisor revisions (the Advisor kept failing to apply a named fix),
    // and the whole run aborted over one number. When few concrete
    // blockers remain, the critic applies its own fixes directly; the
    // result must still clear the boundary validator before publishing.
    const REDPEN_MAX_BLOCKERS = 3;
    if (review.data.verdict !== 'PASS') {
      const blockers = review.data.blockers || [];
      if (blockers.length > 0 && blockers.length <= REDPEN_MAX_BLOCKERS) {
        console.log(`[Orchestrator] ${blockers.length} blocker(s) after ${MAX_REVISIONS} revisions — red-pen pass.`);
        const redpen = await new CriticReviewer().applyFixes({
          draft: advised.data,
          blockers,
          cycleLabel: cycle.cycleLabel,
        });
        meta.agents.CriticReviewer_redpen = redpen.meta;

        const redpenBoundary = validateCycleOutput(redpen.data);
        if (!redpenBoundary.valid) {
          console.error('[Orchestrator] Red-pen output failed boundary validation — aborting.');
          for (const e of redpenBoundary.errors) console.error(`  · ${e}`);
          abort();
        }
        advised = { ...advised, data: redpen.data };
        review = { ...review, data: { ...review.data, verdict: 'PASS', redpen_applied: true } };
        console.log('[Orchestrator] Red-pen output validated — proceeding to publish.');
      } else {
        console.error(`[Orchestrator] Still REVISE after ${MAX_REVISIONS} revisions (${blockers.length} blockers — too many for red-pen). Aborting publish.`);
        console.error('Blockers:', JSON.stringify(blockers, null, 2));
        abort();
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

    // ── COST RECORDING (Best Practice #4) ──────────────────────────
    // BEFORE publishing, so the updated cost-ledger.json is part of the
    // published commit (it used to be written after the push and was lost
    // with the runner). No model call happens after this point.
    const totalCost = meter.summary().cost_usd;
    recordRunCost(cycle.runDate, totalCost, runId, undefined, costDetails('success'));

    // Git (skip if env says so). state.json and the research cache are
    // committed too — the next cycle's delta computation depends on them
    // surviving the ephemeral runner. The cost ledger rides along.
    const gitResult = publishGit({
      archivePath: rendered.archivePath,
      latestPath:  rendered.latestPath,
      rootIndexPath: ROOT_INDEX,
      statePaths: [STATE_PATH, researchCachePath, LEDGER_PATH],
      cycleLabel: cycle.cycleLabel,
      dryRun: process.env.SKIP_GIT_PUSH === 'true',
    });

    const totalMs = Date.now() - startTs;
    console.log(`\n═══ Cycle ${cycle.cycleLabel} complete in ${(totalMs / 1000).toFixed(1)}s ═══`);
    console.log(`  HTML:   ${rendered.latestPath}`);
    console.log(`  Git:    ${gitResult?.sha || gitResult?.reason || (gitResult?.skipped ? 'skipped' : '—')}`);
    const u = meter.summary();
    console.log(`  Cost:   $${totalCost.toFixed(4)} (list price incl. cache + ${u.web_search_requests} web searches` +
      `${u.unknown_usage_calls ? `; ${u.unknown_usage_calls} call(s) with UNKNOWN usage, not priced` : ''})`);
    process.exit(0);
  } catch (err) {
    console.error(`[Orchestrator] Failed: ${err.message}`);
    console.error(err.stack);
    abort();
  }
}

run();
