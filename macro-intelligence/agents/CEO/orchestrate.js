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
  MARKET_SLUGS, RE_SLUGS, LEVERAGE_SLUGS, NON_TRADING_MAX_AGE_DAYS,
} from '../../src/utils/data-cache.js';
import { normalizeAllIndicators } from '../../src/utils/unit-normalizer.js';
import { scorePct10y } from '../Analysis/SignalDetector/skills/signal-scoring.js';

import { MarketDataAnalyst }      from '../DataIntelligence/MarketDataAnalyst/fetch.js';
import { MacroDataAnalyst }       from '../DataIntelligence/MacroDataAnalyst/fetch.js';
import { RealEstateAnalyst }      from '../DataIntelligence/RealEstateAnalyst/fetch.js';
import { LeverageAnalyst }        from '../DataIntelligence/LeverageAnalyst/fetch.js';
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

async function withRetry(fn, agentName, logger) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`${agentName} failed. Retrying once in 5s.`, err.message);
    await new Promise(r => setTimeout(r, 5000));
    return await fn();
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
      logger.fail('Monthly budget cap reached');
      process.exit(1);
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

      if (wsCheck.needsMacroRefresh) {
        macroData = await withRetry(
          () => new MacroDataAnalyst().fetch(isoDate),
          'MacroDataAnalyst', logger
        );
        logger.agent('MacroDataAnalyst', macroData.meta);
      } else {
        console.log('  ⏭ MacroDataAnalyst — all indicators fresh in cache, skipping web_search ($0.50 saved)');
        const cached = getCachedIndicators(isoDate);
        const macroInds = {};
        for (const [slug, val] of Object.entries(cached)) {
          if (!MARKET_SLUGS.has(slug) && !RE_SLUGS.has(slug) && !LEVERAGE_SLUGS.has(slug)) macroInds[slug] = val;
        }
        macroData = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: macroInds }, meta: cachedMeta };
        logger.agent('MacroDataAnalyst', cachedMeta);
      }

      if (wsCheck.needsRERefresh) {
        reData = await withRetry(
          () => new RealEstateAnalyst().fetch(isoDate),
          'RealEstateAnalyst', logger
        );
        logger.agent('RealEstateAnalyst', reData.meta);
      } else {
        console.log('  ⏭ RealEstateAnalyst — all RE indicators fresh in cache, skipping web_search ($0.30 saved)');
        const cached = getCachedIndicators(isoDate);
        const reInds = {};
        for (const [slug, val] of Object.entries(cached)) {
          if (RE_SLUGS.has(slug)) reInds[slug] = val;
        }
        reData = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: reInds }, meta: cachedMeta };
        logger.agent('RealEstateAnalyst', cachedMeta);
      }

      if (wsCheck.needsLeverageRefresh) {
        leverageData = await withRetry(
          () => new LeverageAnalyst().fetch(isoDate),
          'LeverageAnalyst', logger
        );
        logger.agent('LeverageAnalyst', leverageData.meta);
      } else {
        console.log('  ⏭ LeverageAnalyst — all leverage indicators fresh in cache, skipping web_search ($0.30 saved)');
        const cached = getCachedIndicators(isoDate);
        const leverageInds = {};
        for (const [slug, val] of Object.entries(cached)) {
          if (LEVERAGE_SLUGS.has(slug)) leverageInds[slug] = val;
        }
        leverageData = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: leverageInds }, meta: cachedMeta };
        logger.agent('LeverageAnalyst', cachedMeta);
      }

      // Normalize units
      console.log('\n  ── Unit Normalization ──');
      normalizeAllIndicators(marketData.data.prices);
      if (wsCheck.needsMacroRefresh) normalizeAllIndicators(macroData.data.indicators);
      if (wsCheck.needsRERefresh) normalizeAllIndicators(reData.data.indicators);
      if (wsCheck.needsLeverageRefresh) normalizeAllIndicators(leverageData.data.indicators);

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
        () => new ExecutiveSummaryWriter().write({ ...allData, regime, signals, scenarios }),
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

    // ── STEP 4: PRODUCTION ──────────────────────────────────────────
    logger.phase('Production');

    const thisRunCost = logger.estimateCost();
    const costSummary = getCostSummary(isoDate, thisRunCost);

    const { html, macroDataObj, outputPath, indexPath } = new DashboardRenderer().render({
      ...allData, regime, signals, scenarios, news, execSummary, costSummary, dynamicRanges, leverage,
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

    await withRetry(
      () => new SupabaseWriter().sync(macroDataObj, isoDate),
      'SupabaseWriter', logger
    );
    logger.agent('SupabaseWriter', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

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
    logger.fail(err.message);
    recordCostOnFailure();
    process.exit(1);
  }
}

run();
