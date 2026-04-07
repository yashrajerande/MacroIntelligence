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
import { shouldSkipDataIntelligence, getCachedIndicators, updateCache } from '../../src/utils/data-cache.js';

import { MarketDataAnalyst }      from '../DataIntelligence/MarketDataAnalyst/fetch.js';
import { MacroDataAnalyst }       from '../DataIntelligence/MacroDataAnalyst/fetch.js';
import { RealEstateAnalyst }      from '../DataIntelligence/RealEstateAnalyst/fetch.js';
import { RegimeClassifier }       from '../Analysis/RegimeClassifier/classify.js';
import { SignalDetector }         from '../Analysis/SignalDetector/detect.js';
import { ScenarioPlanner }        from '../Analysis/ScenarioPlanner/plan.js';
import { ExecutiveSummaryWriter } from '../Editorial/ExecutiveSummaryWriter/write.js';
import { NewsCurator }            from '../Editorial/NewsCurator/curate.js';
import { DashboardRenderer }      from '../Production/DashboardRenderer/render.js';
import { Validator }              from '../Production/Validator/validate.js';
import { SupabaseWriter }         from '../Infrastructure/SupabaseWriter/sync.js';
import { GitPublisher }           from '../Infrastructure/GitPublisher/publish.js';

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

    if (skipDI) {
      console.log('  ⏭ Weekend/holiday — using cached data from last trading day');
      const cached = getCachedIndicators(isoDate);
      const cachedMeta = { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } };
      // Split cached data back into the 3 agent structures
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
      marketData = await withRetry(
        () => new MarketDataAnalyst().fetch(),
        'MarketDataAnalyst', logger
      );
      logger.agent('MarketDataAnalyst', marketData.meta);

      macroData = await withRetry(
        () => new MacroDataAnalyst().fetch(isoDate),
        'MacroDataAnalyst', logger
      );
      logger.agent('MacroDataAnalyst', macroData.meta);

      reData = await withRetry(
        () => new RealEstateAnalyst().fetch(isoDate),
        'RealEstateAnalyst', logger
      );
      logger.agent('RealEstateAnalyst', reData.meta);

      // Update cache with fresh data
      const allFresh = { ...marketData.data.prices, ...macroData.data.indicators, ...reData.data.indicators };
      updateCache(allFresh, isoDate);
      console.log(`  ✓ Cache updated: ${Object.keys(allFresh).length} indicators`);
    }

    // ── STEP 2: ANALYSIS ────────────────────────────────────────────
    logger.phase('Analysis');
    const allData = { marketData, macroData, reData, isoDate, dateStr };

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

    const [news, execSummary] = await Promise.all([
      withRetry(() => new NewsCurator().curate(isoDate), 'NewsCurator', logger),
      withRetry(
        () => new ExecutiveSummaryWriter().write({ ...allData, regime, signals, scenarios }),
        'ExecutiveSummaryWriter', logger
      ),
    ]);
    logger.agent('NewsCurator', news.meta);
    logger.agent('ExecutiveSummaryWriter', execSummary.meta);

    // ── STEP 4: PRODUCTION ──────────────────────────────────────────
    logger.phase('Production');

    const thisRunCost = logger.estimateCost();
    const costSummary = getCostSummary(isoDate, thisRunCost);

    const { html, macroDataObj, outputPath, indexPath } = new DashboardRenderer().render({
      ...allData, regime, signals, scenarios, news, execSummary, costSummary,
    });
    logger.agent('DashboardRenderer', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

    const validation = new Validator().validate(html, macroDataObj, isoDate);
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

    // ── STEP 5: INFRASTRUCTURE ──────────────────────────────────────
    logger.phase('Infrastructure');

    await withRetry(
      () => new SupabaseWriter().sync(macroDataObj, isoDate),
      'SupabaseWriter', logger
    );
    logger.agent('SupabaseWriter', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

    await new GitPublisher().publish(outputPath, dateStr, indexPath);
    logger.agent('GitPublisher', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

    // ── DONE ────────────────────────────────────────────────────────
    const finalCost = logger.estimateCost();
    recordRunCost(isoDate, finalCost, logger.log.run_id);
    logger.complete({ totalCostUSD: finalCost });
    process.exit(0);

  } catch (err) {
    logger.error('Pipeline failed', err.message, err.stack);
    logger.fail(err.message);
    process.exit(1);
  }
}

run();
