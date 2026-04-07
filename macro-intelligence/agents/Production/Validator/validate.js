/**
 * Validator — Pure code quality gate. No LLM.
 * Runs 22 deterministic checks on the dashboard output.
 */

import { runAllChecks, VALID_SLUGS } from './skills/validation-rules.js';

export class Validator {
  validate(html, macroData, expectedDate) {
    console.log('[Validator] Running 22 validation checks...');
    const result = runAllChecks(html, macroData, expectedDate);

    if (result.valid) {
      console.log(`[Validator] ALL PASS. ${result.warnings.length} warnings.`);
    } else {
      console.error(`[Validator] FAILED. ${result.errors.length} errors:`);
      for (const err of result.errors) {
        console.error(`  ✗ ${err}`);
      }
    }

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.warn(`  ⚠ ${w}`);
      }
    }

    return result;
  }
}

// Standalone test mode
if (process.argv.includes('--test')) {
  console.log('[Validator] Test mode — running with mock data');
  const mockHtml = '<!DOCTYPE html><html><body></body></html>';
  const mockData = {
    run_date: '2026-04-07',
    indicators: VALID_SLUGS.map(slug => ({
      indicator_slug: slug,
      direction: 'up',
      pct_10y_tier: 'mid',
      pct_10y: 50,
      confidence: 'medium',
    })),
    regime: Array.from({ length: 6 }, (_, i) => ({
      dimension: ['growth', 'inflation', 'credit', 'policy', 'capex', 'consumption'][i],
      badge_type: 'b-neu',
    })),
    signals: Array.from({ length: 7 }, (_, i) => ({
      signal_num: i + 1,
      status: i === 6 ? 'surprise' : 'watch',
      is_surprise: i === 6,
    })),
    news: ['geo', 'ai', 'india', 'fintech', 'ifs'].map(cat => ({
      category: cat,
      url: 'https://example.com',
    })),
    executive_summary: Array.from({ length: 5 }, (_, i) => ({ para_num: i + 1 })),
    scenario_base_prob: 0,
    scenario_bull_prob: 0,
    scenario_bear_prob: 0,
  };

  const v = new Validator();
  const result = v.validate(mockHtml, mockData, '2026-04-07');
  console.log(`\nResult: ${result.valid ? 'PASS' : 'FAIL'}`);
  // HTML size check will fail with mock data (expected)
  console.log('Note: Rule 20 (HTML size) will fail with mock data — expected.');
  process.exit(0);
}
