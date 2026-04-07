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
    // ── STEP 1: DATA INTELLIGENCE ──────────────────────────────────
    logger.phase('DataIntelligence');

    const marketData = await withRetry(
      () => new MarketDataAnalyst().fetch(),
      'MarketDataAnalyst', logger
    );
    logger.agent('MarketDataAnalyst', marketData.meta);

    const macroData = await withRetry(
      () => new MacroDataAnalyst().fetch(isoDate),
      'MacroDataAnalyst', logger
    );
    logger.agent('MacroDataAnalyst', macroData.meta);

    const reData = await withRetry(
      () => new RealEstateAnalyst().fetch(isoDate),
      'RealEstateAnalyst', logger
    );
    logger.agent('RealEstateAnalyst', reData.meta);

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

    const { html, macroDataObj, outputPath, indexPath } = new DashboardRenderer().render({
      ...allData, regime, signals, scenarios, news, execSummary,
    });
    logger.agent('DashboardRenderer', { model: 'none', latency_ms: 0, tokens: { input: 0, output: 0 } });

    const validation = new Validator().validate(html, macroDataObj, isoDate);
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
    logger.complete({ totalCostUSD: logger.estimateCost() });
    process.exit(0);

  } catch (err) {
    logger.error('Pipeline failed', err.message, err.stack);
    logger.fail(err.message);
    process.exit(1);
  }
}

run();
