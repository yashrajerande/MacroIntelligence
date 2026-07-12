/**
 * MacroIntelligence Corp — CEO Orchestrator
 * Pipeline coordinator. No data logic. Pure control flow.
 *
 * Execution Sequence:
 *   1. DataIntelligence: MarketDataAnalyst → MacroDataAnalyst → RealEstateAnalyst
 *   2. Analysis: RegimeClassifier → SignalDetector → ScenarioPlanner
 *   3. Editorial: NewsCurator (parallel) + ExecutiveSummaryWriter
 *   4. Production: DashboardRenderer → Validator
 *   5. Infrastructure: SupabaseWriter → GitPublisher
 */

import { getISTDate } from '../../src/utils/ist-date.js';
import { RunLogger } from './run-log.js';
import { checkBudget, recordRunCost, getCostSummary } from '../../src/utils/cost-ledger.js';
import { shouldSkipDataIntelligence, getCachedIndicators, updateCache, checkWebSearchNeeded } from '../../src/utils/data-cache.js';
import { normalizeAllIndicators } from '../../src/utils/unit-normalizer.js';

import { MarketDataAnalyst }      from '../DataIntelligence/MarketDataAnalyst/fetch.js';
import { MacroDataAnalyst }       from '../DataIntelligence/MacroDataAnalyst/fetch.js';
import { RealEstateAnalyst }      from '../DataIntelligence/RealEstateAnalyst/fetch.js';
import { RegimeClassifier }       from '../Analysis/RegimeClassifier/classify.js';
import { SignalDetector }         from '../Analysis/SignalDetector/detect.js';
import { ScenarioPlanner }        from '../Analysis/ScenarioPlanner/plan.js';
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

    let marketData, macroData, reData;
    const skipDI = shouldSkipDataIntelligence(isoDate);
    const cachedMeta = { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } };

    if (skipDI) {
      // Weekend/holiday — use ALL cached data
      console.log('  ⏭ Weekend/holiday — using cached data from last trading day');
      const cached = getCachedIndicators(isoDate);
      const marketPrices = {}, macroInds = {}, reInds = {};
      const MARKET_SLUGS = new Set(['nifty50','sensex','bank_nifty','india_vix','inr_usd','gold_usd','gold_inr_gram','brent_usd','sp500','nasdaq','us_vix','dxy','nat_gas','copper','iron_ore','nikkei225','hang_seng','euro_stoxx50','brent_usd_global','wti_usd','bdi','us_10y_treasury','gsec_10y','rbi_fx_reserves']);
      const RE_SLUGS = new Set(['re_launches_units','re_sales_units','re_unsold_inventory','hpi_mumbai','hpi_delhi','hpi_bengaluru','hpi_hyderabad','affordability_index','home_loan_disbursements','avg_home_loan_rate','office_absorption','office_vacancy','rent_bengaluru','rent_mumbai','retail_mall_vacancy','embassy_reit','mindspace_reit','brookfield_reit']);
      for (const [slug, val] of Object.entries(cached)) {
        if (MARKET_SLUGS.has(slug)) marketPrices[slug] = val;
        else if (RE_SLUGS.has(slug)) reInds[slug] = val;
        else macroInds[slug] = val;
      }
      marketData = { data: { generated_at: new Date().toISOString(), run_date: isoDate, prices: marketPrices }, meta: cachedMeta };
      macroData  = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: macroInds }, meta: cachedMeta };
      reData     = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: reInds }, meta: cachedMeta };
      logger.agent('MarketDataAnalyst', cachedMeta);
      logger.agent('MacroDataAnalyst', cachedMeta);
      logger.agent('RealEstateAnalyst', cachedMeta);
    } else {
      // ── Market prices: ALWAYS fetch (free via Yahoo/FRED) ──────
      marketData = await withRetry(
        () => new MarketDataAnalyst().fetch(),
        'MarketDataAnalyst', logger
      );
      logger.agent('MarketDataAnalyst', marketData.meta);

      // ── Macro + RE: only web_search when indicators are STALE ──
      const wsCheck = checkWebSearchNeeded(isoDate);
      console.log(`  ℹ Cache: ${wsCheck.cachedCount} indicators cached, ${wsCheck.staleSlugs.length} stale`);
      console.log(`  ℹ Macro refresh needed: ${wsCheck.needsMacroRefresh} | RE refresh needed: ${wsCheck.needsRERefresh}`);

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
        const RE_SLUGS = new Set(['re_launches_units','re_sales_units','re_unsold_inventory','hpi_mumbai','hpi_delhi','hpi_bengaluru','hpi_hyderabad','affordability_index','home_loan_disbursements','avg_home_loan_rate','office_absorption','office_vacancy','rent_bengaluru','rent_mumbai','retail_mall_vacancy','embassy_reit','mindspace_reit','brookfield_reit']);
        const MARKET_SLUGS = new Set(['nifty50','sensex','bank_nifty','india_vix','inr_usd','gold_usd','gold_inr_gram','brent_usd','sp500','nasdaq','us_vix','dxy','nat_gas','copper','iron_ore','nikkei225','hang_seng','euro_stoxx50','brent_usd_global','wti_usd','bdi','us_10y_treasury','gsec_10y','rbi_fx_reserves']);
        for (const [slug, val] of Object.entries(cached)) {
          if (!MARKET_SLUGS.has(slug) && !RE_SLUGS.has(slug)) macroInds[slug] = val;
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
        const RE_SLUGS = new Set(['re_launches_units','re_sales_units','re_unsold_inventory','hpi_mumbai','hpi_delhi','hpi_bengaluru','hpi_hyderabad','affordability_index','home_loan_disbursements','avg_home_loan_rate','office_absorption','office_vacancy','rent_bengaluru','rent_mumbai','retail_mall_vacancy','embassy_reit','mindspace_reit','brookfield_reit']);
        for (const [slug, val] of Object.entries(cached)) {
          if (RE_SLUGS.has(slug)) reInds[slug] = val;
        }
        reData = { data: { generated_at: new Date().toISOString(), run_date: isoDate, indicators: reInds }, meta: cachedMeta };
        logger.agent('RealEstateAnalyst', cachedMeta);
      }

      // Normalize units
      console.log('\n  ── Unit Normalization ──');
      normalizeAllIndicators(marketData.data.prices);
      if (wsCheck.needsMacroRefresh) normalizeAllIndicators(macroData.data.indicators);
      if (wsCheck.needsRERefresh) normalizeAllIndicators(reData.data.indicators);

      // Update cache with all data (fresh + cached)
      const allFresh = { ...marketData.data.prices, ...macroData.data.indicators, ...reData.data.indicators };
      updateCache(allFresh, isoDate);
      console.log(`  ✓ Cache updated: ${Object.keys(allFresh).length} indicators`);
    }

    // ── STEP 2: ANALYSIS ────────────────────────────────────────────
    logger.phase('Analysis');

    // Fetched once, used three ways: trend context for the LLM agents,
    // sparklines in the renderer, and z-score bounds in the validator.
    const dynamicRanges = await fetchDynamicRanges();

    const allData = { marketData, macroData, reData, isoDate, dateStr, dynamicRanges };

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
      ...allData, regime, signals, scenarios, news, execSummary, costSummary, dynamicRanges,
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
    process.exit(1);
  }
}

run();
