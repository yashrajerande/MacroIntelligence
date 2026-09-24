/**
 * MacroIntelligence Corp — CEO Orchestrator
 * Pipeline coordinator. No data logic. Pure control flow.
 *
 * Execution Sequence:
 *   1. DataIntelligence: MarketDataAnalyst → MacroDataAnalyst → RealEstateAnalyst → LeverageAnalyst
 *   2. Analysis: RegimeClassifier → SignalDetector → ScenarioPlanner → LeverageAnalyzer
 *   3. Editorial: NewsCurator (parallel) + ExecutiveSummaryWriter
 *   4. Production: DashboardRenderer → Validator
 *   5. Infrastructure: SupabaseWriter → GitPublisher
 */

import { getISTDate } from '../../src/utils/ist-date.js';
import { RunLogger } from './run-log.js';
import { checkBudget, recordRunCost, getCostSummary } from '../../src/utils/cost-ledger.js';
import {
  shouldSkipDataIntelligence, getCachedIndicators, updateCache, checkWebSearchNeeded,
  readCache, backfillFromCache, healFutureVintages,
  MARKET_SLUGS, RE_SLUGS, LEVERAGE_SLUGS, NON_TRADING_MAX_AGE_DAYS,
} from '../../src/utils/data-cache.js';
import { scrubReaderSurfaces } from '../../src/utils/banned-names.js';
import {
  classifyModelError, isTerminalModelError, retryDelaysFor,
  preflightModelCheck, alreadyPublished, sendFailureAlert, currentRunUrl,
} from '../../src/utils/resilience.js';
import { normalizeAllIndicators } from '../../src/utils/unit-normalizer.js';
import { scorePct10y } from '../Analysis/SignalDetector/skills/signal-scoring.js';

import { MarketDataAnalyst }      from '../DataIntelligence/MarketDataAnalyst/fetch.js';
import { MacroDataAnalyst }       from '../DataIntelligence/MacroDataAnalyst/fetch.js';
import { RealEstateAnalyst }      from '../DataIntelligence/RealEstateAnalyst/fetch.js';
import { LeverageAnalyst }        from '../DataIntelligence/LeverageAnalyst/fetch.js';
import { RealEstateSegmentAnalyst } from '../DataIntelligence/RealEstateSegmentAnalyst/fetch.js';
import { RealEstateSegmentAnalyzer } from '../Analysis/RealEstateSegmentAnalyzer/analyze.js';
import { RegimeClassifier }       from '../Analysis/RegimeClassifier/classify.js';
import { SignalDetector }         from '../Analysis/SignalDetector/detect.js';
import { ScenarioPlanner }        from '../Analysis/ScenarioPlanner/plan.js';
import { LeverageAnalyzer }       from '../Analysis/LeverageAnalyzer/analyze.js';
import { ExecutiveSummaryWriter } from '../Editorial/ExecutiveSummaryWriter/write.js';
import { NewsCurator }            from '../Editorial/NewsCurator/curate.js';
import { DashboardRenderer }      from '../Production/DashboardRenderer/render.js';
import { VoiceBroadcaster }      from '../Production/VoiceBroadcaster/broadcast.js';
import { Validator }              from '../Production/Validator/validate.js';
import { fetchDynamicRanges }    from '../Production/Validator/skills/dynamic-ranges.js';
import { SupabaseWriter }         from '../Infrastructure/SupabaseWriter/sync.js';
import { GitPublisher }           from '../Infrastructure/GitPublisher/publish.js';
import { TelegramPublisher }      from '../Infrastructure/TelegramPublisher/publish.js';
import { OpsManager }             from '../Infrastructure/OpsManager/report.js';

// Retry with a schedule chosen by WHY it failed: rate limits and
// overloads get three spaced attempts, a genuine bug still gets the
// original single retry, and billing/auth (which no retry can fix) are
// rethrown immediately so the run can alert instead of burning minutes.
async function withRetry(fn, agentName, logger) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const kind = classifyModelError(err);
      if (isTerminalModelError(kind)) throw err;
      const delays = retryDelaysFor(kind);
      if (attempt >= delays.length) throw err;
      const delay = delays[attempt++];
      logger.warn(`${agentName} failed (${kind || 'error'}). Retry ${attempt}/${delays.length} in ${delay / 1000}s.`, err.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// LLM-backed data fetch with a cache fallback: if the model is the thing
// that is down (overloaded, 5xx, exhausted retries), yesterday's cached
// set is a far better edition than no edition. Non-model errors (a bug
// in the fetcher) still propagate so they get fixed.
async function fetchOrCached(fn, agentName, logger, cachedSet) {
  try {
    return await withRetry(fn, agentName, logger);
  } catch (err) {
    const kind = classifyModelError(err);
    if (!kind || isTerminalModelError(kind)) throw err;
    console.warn(`  ⚠ ${agentName} unavailable (${kind}) — serving cached indicators for today's edition`);
    logger.warn(`${agentName} served from cache (${kind})`, err.message);
    return cachedSet();
  }
}

async function run() {
  const runStartTime = Date.now();
  const { dateStr, isoDate } = getISTDate();
  const logger = new RunLogger(isoDate);
  logger.start(dateStr);

  // A failed run has still spent real API money — every exit path must
  // charge the ledger, or a recurring failure burns the monthly budget
  // without the cap ever binding.
  let costRecorded = false;
  const recordCostOnFailure = () => {
    if (costRecorded) return;
    try {
      recordRunCost(isoDate, logger.estimateCost(), logger.log.run_id);
      costRecorded = true;
    } catch { /* ledger write is best-effort on the failure path */ }
  };

  try {
    // ── BUDGET GUARD ────────────────────────────────────────────────
    const budget = checkBudget(isoDate);
    console.log(`  Budget: $${budget.month_spend_usd} spent / $${budget.budget_usd} cap · $${budget.remaining_usd} remaining`);
    if (!budget.allowed) {
      logger.error('Budget exceeded', `Monthly spend $${budget.month_spend_usd} exceeds $${budget.budget_usd} cap`);
      await sendFailureAlert({ dateStr, kind: 'budget', reason: `Monthly spend $${budget.month_spend_usd} exceeds $${budget.budget_usd} cap`, runUrl: currentRunUrl(), phase: 'Budget guard' });
      logger.fail('Monthly budget cap reached');
      process.exit(1);
    }

    // ── RETRY-WINDOW GUARD ──────────────────────────────────────────
    // The workflow fires at 03:00 IST and again at 05:00 IST. The second
    // firing exists to recover from a transient failure; when the first
    // one already published today's edition it must do nothing (and pay
    // nothing). Manual runs set FORCE_RERUN so a human can always re-run.
    if (process.env.FORCE_RERUN !== 'true' && alreadyPublished(isoDate)) {
      console.log(`  ⏭ ${dateStr} edition is already published — nothing to do (retry window no-op)`);
      logger.complete({ totalCostUSD: 0, skipped: 'already_published' });
      process.exit(0);
    }

    // ── MODEL PRE-FLIGHT ────────────────────────────────────────────
    // One-token call. An empty balance or a revoked key fails here in a
    // second, with the fix in Telegram, instead of after five agents
    // have each spent money and then died on the same error.
    {
      const pf = await preflightModelCheck();
      if (!pf.ok) {
        logger.error('Model pre-flight failed', pf.message);
        await sendFailureAlert({ dateStr, kind: pf.kind, reason: pf.message, runUrl: currentRunUrl(), phase: 'Pre-flight' });
        logger.fail(`Model pre-flight failed (${pf.kind})`);
        process.exit(1);
      }
      if (pf.kind) logger.warn('Model pre-flight degraded', pf.message);
    }

    // ── STEP 1: DATA INTELLIGENCE ──────────────────────────────────
    logger.phase('DataIntelligence');

    let marketData, macroData, reData, leverageData;
    const skipDI = shouldSkipDataIntelligence(isoDate);
    const cachedMeta = { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } };

    if (skipDI) {
      // Weekend/holiday — use ALL cached data
      console.log('  ⏭ Weekend/holiday — using cached data from last trading day');
      // Same window as shouldSkipDataIntelligence, or Friday's daily prices
      // get dropped as "stale" and the validator fails on 24 missing slugs.
      const cached = getCachedIndicators(isoDate, { maxAgeDays: NON_TRADING_MAX_AGE_DAYS });
      const marketPrices = {}, macroInds = {}, reInds = {}, leverageInds = {};
      for (const [slug, val] of Object.entries(cached)) {
        if (MARKET_SLUGS.has(slug)) marketPrices[slug] = val;
        else if (RE_SLUGS.has(slug)) reInds[slug] = val;
        else if (LEVERAGE_SLUGS.has(slug)) leverageInds[slug] = val;
        else macroInds[slug] = val;
      }
      marketData   = { data: { generated_at: new Date().toISOString(), run_date: isoDate, prices: marketPrices }, meta: cachedMeta };
      macroData    = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: macroInds }, meta: cachedMeta };
      reData       = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: reInds }, meta: cachedMeta };
      leverageData = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: leverageInds }, meta: cachedMeta };
      logger.agent('MarketDataAnalyst', cachedMeta);
      logger.agent('MacroDataAnalyst', cachedMeta);
      logger.agent('RealEstateAnalyst', cachedMeta);
      logger.agent('LeverageAnalyst', cachedMeta);
    } else {
      // ── Market prices: ALWAYS fetch (free via Yahoo/FRED) ──────
      marketData = await withRetry(
        () => new MarketDataAnalyst().fetch(),
        'MarketDataAnalyst', logger
      );
      logger.agent('MarketDataAnalyst', marketData.meta);

      // ── Macro + RE + Leverage: only web_search when indicators are STALE ──
      const wsCheck = checkWebSearchNeeded(isoDate);
      console.log(`  ℹ Cache: ${wsCheck.cachedCount} indicators cached, ${wsCheck.staleSlugs.length} stale`);
      console.log(`  ℹ Macro refresh needed: ${wsCheck.needsMacroRefresh} | RE refresh needed: ${wsCheck.needsRERefresh} | Leverage refresh needed: ${wsCheck.needsLeverageRefresh}`);

      // One cache reader for the three LLM-backed sets. Used both when the
      // cache is fresh (skip the spend) and when the model is down (serve
      // yesterday's numbers rather than no edition). On a fallback the
      // stale-but-real values will be older than the freshness window;
      // that is the point — an honest older print beats "Awaited".
      const cachedSetFor = (pred, { anyAge = false } = {}) => {
        const cached = getCachedIndicators(isoDate, anyAge ? { maxAgeDays: 3650 } : undefined);
        const inds = {};
        for (const [slug, val] of Object.entries(cached)) if (pred(slug)) inds[slug] = val;
        return { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: inds }, meta: cachedMeta };
      };
      const isMacro    = slug => !MARKET_SLUGS.has(slug) && !RE_SLUGS.has(slug) && !LEVERAGE_SLUGS.has(slug);
      const isRE       = slug => RE_SLUGS.has(slug);
      const isLeverage = slug => LEVERAGE_SLUGS.has(slug);

      if (wsCheck.needsMacroRefresh) {
        macroData = await fetchOrCached(
          () => new MacroDataAnalyst().fetch(isoDate),
          'MacroDataAnalyst', logger, () => cachedSetFor(isMacro, { anyAge: true })
        );
        logger.agent('MacroDataAnalyst', macroData.meta);
      } else {
        console.log('  ⏭ MacroDataAnalyst — all indicators fresh in cache, skipping web_search ($0.50 saved)');
        macroData = cachedSetFor(isMacro);
        logger.agent('MacroDataAnalyst', cachedMeta);
      }

      if (wsCheck.needsRERefresh) {
        reData = await fetchOrCached(
          () => new RealEstateAnalyst().fetch(isoDate),
          'RealEstateAnalyst', logger, () => cachedSetFor(isRE, { anyAge: true })
        );
        logger.agent('RealEstateAnalyst', reData.meta);
      } else {
        console.log('  ⏭ RealEstateAnalyst — all RE indicators fresh in cache, skipping web_search ($0.30 saved)');
        reData = cachedSetFor(isRE);
        logger.agent('RealEstateAnalyst', cachedMeta);
      }

      if (wsCheck.needsLeverageRefresh) {
        leverageData = await fetchOrCached(
          () => new LeverageAnalyst().fetch(isoDate),
          'LeverageAnalyst', logger, () => cachedSetFor(isLeverage, { anyAge: true })
        );
        logger.agent('LeverageAnalyst', leverageData.meta);
      } else {
        console.log('  ⏭ LeverageAnalyst — all leverage indicators fresh in cache, skipping web_search ($0.30 saved)');
        leverageData = cachedSetFor(isLeverage);
        logger.agent('LeverageAnalyst', cachedMeta);
      }

      // Normalize units
      console.log('\n  ── Unit Normalization ──');
      normalizeAllIndicators(marketData.data.prices);
      if (wsCheck.needsMacroRefresh) normalizeAllIndicators(macroData.data.indicators);
      if (wsCheck.needsRERefresh) normalizeAllIndicators(reData.data.indicators);
      if (wsCheck.needsLeverageRefresh) normalizeAllIndicators(leverageData.data.indicators);

      // Backfill the day's OUTPUT for slugs a refresh fetch missed. The cache
      // guard already keeps the old value on disk, but the dashboard still
      // rendered "Awaited" for that day — so a refresh day could blank out
      // rows the cache knew perfectly well. Read the cache once, before
      // updateCache rewrites it.
      {
        const cachedNow = readCache().indicators;
        let backfilled = 0;
        backfilled += backfillFromCache(marketData.data.prices, cachedNow);
        if (wsCheck.needsMacroRefresh) backfilled += backfillFromCache(macroData.data.indicators, cachedNow);
        if (wsCheck.needsRERefresh) backfilled += backfillFromCache(reData.data.indicators, cachedNow);
        if (wsCheck.needsLeverageRefresh) backfilled += backfillFromCache(leverageData.data.indicators, cachedNow);
        if (backfilled > 0) console.log(`  ↩ Backfilled ${backfilled} missed fetch(es) from cache for today's output`);

        // A vintage after the run date is an extractor misread (a scheduled
        // release date, not a period). Swap in the cached print — or blank
        // the vintage — BEFORE updateCache so the bad stamp never persists
        // and the Validator's vintage layer has nothing to fail on.
        const healed = [
          ...healFutureVintages(marketData.data.prices, cachedNow, isoDate),
          ...(wsCheck.needsMacroRefresh ? healFutureVintages(macroData.data.indicators, cachedNow, isoDate) : []),
          ...(wsCheck.needsRERefresh ? healFutureVintages(reData.data.indicators, cachedNow, isoDate) : []),
          ...(wsCheck.needsLeverageRefresh ? healFutureVintages(leverageData.data.indicators, cachedNow, isoDate) : []),
        ];
        if (healed.length > 0) {
          console.log(`  ↩ Healed ${healed.length} future-vintage print(s) from cache: ${healed.join(', ')}`);
          logger.warn('Future vintage healed', healed.join(', '));
        }
      }

      // Update the cache with ONLY genuinely-fetched data. Feeding the
      // cache-served branches back in re-stamped every slug's last_updated
      // daily, so no monthly/quarterly indicator could EVER go stale again
      // — production was serving Feb-2026 vintages as "fetched today" in
      // September. Merge order: web-search sets first, API market prices
      // LAST, so a Haiku-scraped number can never override a FRED/Yahoo
      // value for the 7 overlapping US series.
      const allFresh = {
        ...(wsCheck.needsMacroRefresh ? macroData.data.indicators : {}),
        ...(wsCheck.needsRERefresh ? reData.data.indicators : {}),
        ...(wsCheck.needsLeverageRefresh ? leverageData.data.indicators : {}),
        ...marketData.data.prices,
      };
      updateCache(allFresh, isoDate);
      console.log(`  ✓ Cache updated: ${Object.keys(allFresh).length} freshly-fetched indicators`);
    }

    // ── Segmented real estate (ticket size × city × NRI) ─────────────
    // Founder's work order, 24 SEP 2026. Weekly fetch, snapshot served in
    // between (see the analyst for the cadence). Non-fatal: the edition
    // publishes without the segment panel rather than not at all.
    let reSegments = { data: { latest: null, history: [] }, meta: { agent: 'RealEstateSegmentAnalyst', model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } } };
    try {
      reSegments = await withRetry(() => new RealEstateSegmentAnalyst().fetch(isoDate), 'RealEstateSegmentAnalyst', logger);
      logger.agent('RealEstateSegmentAnalyst', reSegments.meta);
    } catch (err) {
      console.warn(`  ⚠ RealEstateSegmentAnalyst failed (non-fatal): ${err.message}`);
      logger.warn('RealEstateSegmentAnalyst failed', err.message);
    }

    // ── Re-score percentiles AFTER normalization ─────────────────────
    // scorePct10y used to run inside the fetchers, BEFORE the unit
    // normalizer — so inr_usd was scored on the raw 0.0106 quote (0th
    // percentile of [55,100]) and kept that score after inversion to
    // 94.34. Polarity Guard 1 then rejected it as inconsistent, silently
    // excluding the FX flagship from every signal and hook. Re-scoring
    // here (both fetch and cache-served paths) makes pct_10y always
    // describe the value actually displayed.
    {
      const rescoreAll = {
        ...macroData.data.indicators, ...reData.data.indicators,
        ...leverageData.data.indicators, ...marketData.data.prices,
      };
      for (const [slug, ind] of Object.entries(rescoreAll)) {
        if (!ind || typeof ind.value !== 'number') continue;
        const scored = scorePct10y(slug, ind.value);
        if (scored) {
          ind.pct_10y = scored.pct_10y;
          ind.pct_10y_tier = scored.pct_10y_tier;
          if (scored.pct_note) ind.pct_note = scored.pct_note;
        }
      }
    }

    // ── STEP 2: ANALYSIS ────────────────────────────────────────────
    logger.phase('Analysis');

    // Fetched once, used three ways: trend context for the LLM agents,
    // sparklines in the renderer, and z-score bounds in the validator.
    const dynamicRanges = await fetchDynamicRanges();

    const allData = { marketData, macroData, reData, leverageData, isoDate, dateStr, dynamicRanges };

    const regime = await withRetry(
      () => new RegimeClassifier().classify(allData),
      'RegimeClassifier', logger
    );
    logger.agent('RegimeClassifier', regime.meta);

    const signals = await withRetry(
      () => new SignalDetector().detect({ ...allData, regime }),
      'SignalDetector', logger
    );
    logger.agent('SignalDetector', signals.meta);

    const scenarios = await withRetry(
      () => new ScenarioPlanner().plan({ ...allData, regime, signals }),
      'ScenarioPlanner', logger
    );
    logger.agent('ScenarioPlanner', scenarios.meta);

    // Pure code, no LLM — computes the Keen/Minsky credit-impulse read from
    // accumulated history. Never throws (no external calls), so no retry needed.
    // API-sourced market prices spread LAST so they win the 7-slug overlap
    // with the LLM web-search set (us_cpi, fed_funds_rate, etc.).
    const allIndicatorsForLeverage = {
      ...macroData.data.indicators, ...reData.data.indicators,
      ...leverageData.data.indicators, ...marketData.data.prices,
    };
    const leverage = new LeverageAnalyzer().analyze(allIndicatorsForLeverage, dynamicRanges);
    logger.agent('LeverageAnalyzer', leverage.meta);

    // Pure code, no LLM — supply/demand balance by ticket size, city
    // ranking, NRI direction from the dated history, commercial by city.
    const reSegmentRead = new RealEstateSegmentAnalyzer().analyze(reSegments.data);
    logger.agent('RealEstateSegmentAnalyzer', reSegmentRead.meta);

    // ── STEP 3: EDITORIAL ───────────────────────────────────────────
    logger.phase('Editorial');

    // News is nice-to-have; the summary is the flagship. A news failure must
    // not take the ExecutiveSummaryWriter (or the run) down with it.
    const FALLBACK_NEWS = [
      { category: 'geo',     headline: 'Feed unavailable — tap for latest world coverage',   url: 'https://www.reuters.com/world/',            source_name: 'Reuters',      buzz_tag: '' },
      { category: 'ai',      headline: 'Feed unavailable — tap for latest AI coverage',      url: 'https://www.theverge.com/ai-artificial-intelligence', source_name: 'The Verge', buzz_tag: '' },
      { category: 'india',   headline: 'Feed unavailable — tap for latest India coverage',   url: 'https://www.livemint.com/economy',          source_name: 'LiveMint',     buzz_tag: '' },
      { category: 'fintech', headline: 'Feed unavailable — tap for latest fintech coverage', url: 'https://www.moneycontrol.com/news/business/', source_name: 'Moneycontrol', buzz_tag: '' },
      { category: 'ifs',     headline: 'Feed unavailable — tap for latest markets coverage', url: 'https://www.reuters.com/markets/',          source_name: 'Reuters',      buzz_tag: '' },
    ];

    const [newsSettled, execSummary] = await Promise.all([
      withRetry(() => new NewsCurator().curate(isoDate), 'NewsCurator', logger)
        .catch(err => {
          console.warn(`  ⚠ NewsCurator failed after retry (non-fatal): ${err.message}`);
          logger.warn('NewsCurator failed — using fallback links', err.message);
          return {
            data: FALLBACK_NEWS,
            meta: { agent: 'NewsCurator', model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 }, fallback: true },
          };
        }),
      withRetry(
        () => new ExecutiveSummaryWriter().write({ ...allData, regime, signals, scenarios, reSegments: reSegmentRead }),
        'ExecutiveSummaryWriter', logger
      ),
    ]);
    const news = newsSettled;
    logger.agent('NewsCurator', news.meta);
    logger.agent('ExecutiveSummaryWriter', execSummary.meta);

    // Apply Sonnet-generated regime narratives back to regime data
    if (execSummary.regime_narratives) {
      for (const r of regime.data) {
        const narrative = execSummary.regime_narratives[r.dimension];
        if (narrative) r.signal_text = narrative;
      }
      console.log('  ✓ Regime narratives upgraded by Sonnet');
    }

    // Persona anchors (Mishra, Munger, FT…) are for thinking, never for
    // attribution. When a model still writes "as Mishra notes", rewrite
    // the sentence here rather than fail the edition at the Validator
    // after every agent has spent its budget. L7 still scans afterwards
    // and warns if anything slipped through.
    {
      const scrubbed = scrubReaderSurfaces({ execSummary, regime, signals, leverage });
      if (scrubbed > 0) {
        console.log(`  ↩ Scrubbed persona-anchor attribution from ${scrubbed} reader-facing field(s)`);
        logger.warn('Persona-anchor leak scrubbed', `${scrubbed} field(s)`);
      }
    }

    // ── STEP 4: PRODUCTION ──────────────────────────────────────────
    logger.phase('Production');

    const thisRunCost = logger.estimateCost();
    const costSummary = getCostSummary(isoDate, thisRunCost);

    const { html, macroDataObj, outputPath, indexPath } = new DashboardRenderer().render({
      ...allData, regime, signals, scenarios, news, execSummary, costSummary, dynamicRanges, leverage,
      reSegments: reSegmentRead,
    });
    logger.agent('DashboardRenderer', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

    // Voice briefing (non-blocking — pipeline continues even if TTS fails)
    let voiceResult = { audioPath: null, latestAudioPath: null };
    try {
      voiceResult = await new VoiceBroadcaster().generate({
        verdictLine: execSummary.verdict_line || macroDataObj.run.snap_verdict,
        macroDataObj,
        dateStr,
        isoDate,
      });
      logger.agent('VoiceBroadcaster', voiceResult.meta);
    } catch (err) {
      console.warn(`  ⚠ VoiceBroadcaster failed (non-fatal): ${err.message}`);
      logger.warn('VoiceBroadcaster failed', err.message);
    }

    const validation = await new Validator().validate(html, macroDataObj, isoDate, dynamicRanges);
    logger.validation(validation);
    logger.agent('Validator', {
      model: 'none', latency_ms: 0,
      tokens: { input: 0, output: 0 },
      checks: validation.errors.length === 0 ? 'ALL_PASS' : 'FAILED',
    });

    if (!validation.valid) {
      logger.error('Validation failed', validation.errors.join('; '));
      await sendFailureAlert({ dateStr, kind: 'validation', reason: validation.errors.join('; '), runUrl: currentRunUrl(), phase: 'Production' });
      logger.fail('Validation failed');
      recordCostOnFailure();
      process.exit(1);
    }

    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) {
        logger.warn('Validation warning', w);
      }
    }

    logger.setOutputFile(outputPath);

    // ── Ops Cockpit (non-blocking — pipeline continues if it fails) ──
    let cockpitPath = null;
    try {
      const agentMetas = logger.log?.agents || {};
      const cockpitResult = await new OpsManager().report({
        dateStr,
        isoDate,
        agentMetas,
        feedHealth: news.feedHealth || null,
        runStartTime,
        validation,
        // The ledger has no entry for today yet (recordRunCost runs later,
        // just before GitPublisher), so the cockpit needs this run's cost
        // passed in — reading the ledger alone always showed $0.00.
        currentRunCost: logger.estimateCost(),
      });
      cockpitPath = cockpitResult.outputPath;
      logger.agent('OpsManager', cockpitResult.meta);
    } catch (err) {
      console.warn(`  ⚠ OpsManager failed (non-fatal): ${err.message}`);
      logger.warn('OpsManager failed', err.message);
    }

    // ── STEP 5: INFRASTRUCTURE ──────────────────────────────────────
    logger.phase('Infrastructure');

    // Supabase persistence is the history, the dashboard is the product.
    // A paused free-tier project must not stop today's edition from
    // publishing; the history gap is announced in Telegram instead.
    try {
      await withRetry(
        () => new SupabaseWriter().sync(macroDataObj, isoDate),
        'SupabaseWriter', logger
      );
      logger.agent('SupabaseWriter', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });
    } catch (err) {
      console.warn(`  ⚠ SupabaseWriter failed (non-fatal, dashboard still publishes): ${err.message}`);
      logger.warn('SupabaseWriter failed', err.message);
      await sendFailureAlert({ dateStr, kind: 'supabase', reason: err.message, runUrl: currentRunUrl(), phase: 'Infrastructure (dashboard still published)' });
    }

    // Record cost BEFORE publishing so the updated cost-ledger.json is part
    // of the commit — otherwise every fresh CI checkout sees $0 spent and
    // the monthly budget cap never binds.
    const finalCost = logger.estimateCost();
    recordRunCost(isoDate, finalCost, logger.log.run_id);
    costRecorded = true;

    // GitPublisher pushes every run — the most transient-failure-prone step.
    await withRetry(
      () => new GitPublisher().publish(outputPath, dateStr, indexPath),
      'GitPublisher', logger
    );
    logger.agent('GitPublisher', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

    // Telegram delivery (non-blocking)
    try {
      const telegramResult = await new TelegramPublisher().publish({
        verdictLine: execSummary.verdict_line || macroDataObj.run.snap_verdict,
        macroDataObj,
        dateStr,
        isoDate,
        dashboardUrl: 'https://yashrajerande.github.io/MacroIntelligence/',
        audioPath: voiceResult.audioPath || voiceResult.latestAudioPath,
      });
      logger.agent('TelegramPublisher', telegramResult.meta);
    } catch (err) {
      console.warn(`  ⚠ TelegramPublisher failed (non-fatal): ${err.message}`);
      logger.warn('TelegramPublisher failed', err.message);
    }

    // ── DONE ────────────────────────────────────────────────────────
    logger.complete({ totalCostUSD: finalCost });
    process.exit(0);

  } catch (err) {
    logger.error('Pipeline failed', err.message, err.stack);
    const kind = classifyModelError(err) || (/git|push|remote/i.test(err.message) ? 'git' : 'unknown');
    await sendFailureAlert({ dateStr, kind, reason: err.message, runUrl: currentRunUrl(), phase: logger.currentPhase || null });
    logger.fail(err.message);
    recordCostOnFailure();
    process.exit(1);
  }
}

run();
