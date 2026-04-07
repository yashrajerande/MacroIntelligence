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
    run: {
      run_date: '2026-04-07',
      ist_time: '06:00 IST',
      snap_verdict: 'Steady Growth | Moderate Inflation',
      snap_india: 'Nifty 23,500 | INR/USD 83.2',
      snap_global: 'Brent $82 | DXY 104',
      snap_risk: 'Monitoring',
      india_regime: 'Steady',
      global_regime: 'Neutral',
      scenario_base_prob: 0,
      scenario_base_name: 'Soft Landing',
      scenario_base_txt: 'Base scenario text.',
      scenario_bull_prob: 0,
      scenario_bull_name: 'Bull Run',
      scenario_bull_txt: 'Bull scenario text.',
      scenario_bear_prob: 0,
      scenario_bear_name: 'Hard Landing',
      scenario_bear_txt: 'Bear scenario text.',
    },
    indicators: VALID_SLUGS.map(slug => ({
      indicator_slug: slug,
      indicator_name: slug.replace(/_/g, ' '),
      section: 'S2',
      sub_section: 'growth',
      latest_value: '100',
      latest_numeric: 100,
      latest_unit: '',
      previous_value: '99',
      previous_numeric: 99,
      data_vintage: 'Mar 2026',
      direction: 'up',
      pct_10y_tier: 'mid',
      pct_10y: 50,
      pct_note: '',
      is_estimated: false,
      source: 'Test',
      confidence: 'medium',
    })),
    regime: Array.from({ length: 6 }, (_, i) => ({
      dimension: ['growth', 'inflation', 'credit', 'policy', 'capex', 'consumption'][i],
      badge_type: 'b-neu',
      badge_label: 'Neutral',
      metric_summary: 'Test metric summary.',
      signal_text: 'Test signal text.',
    })),
    signals: Array.from({ length: 7 }, (_, i) => ({
      signal_num: i + 1,
      signal_theme: 'TEST',
      status: i === 6 ? 'surprise' : 'watch',
      is_surprise: i === 6,
      title: 'Test signal title',
      data_text: 'Test data text',
      implication: 'Test implication',
      pct_10y: 50,
      pct_note: '',
    })),
    news: ['geo', 'ai', 'india', 'fintech', 'ifs'].map(cat => ({
      category: cat,
      headline: 'Test headline',
      url: 'https://example.com',
      source_name: 'Test',
      buzz_tag: 'hot',
    })),
    executive_summary: Array.from({ length: 5 }, (_, i) => ({
      para_num: i + 1,
      para_label: 'Test',
      para_html: 'Test paragraph content with enough length to pass validation check.',
    })),
    real_estate: {
      re_summary_text: 'Test summary.',
      residential_regime: 'Stable',
      commercial_regime: 'Stable',
      reit_vs_gsec_spread_bps: 150,
      key_risk_note: 'None.',
    },
  };

  const v = new Validator();
  const result = v.validate(mockHtml, mockData, '2026-04-07');
  console.log(`\nResult: ${result.valid ? 'PASS' : 'FAIL'}`);
  // HTML size check will fail with mock data (expected)
  console.log('Note: Rule 20 (HTML size) and L6 (range bounds) will fail with mock data — expected.');
  process.exit(0);
}
