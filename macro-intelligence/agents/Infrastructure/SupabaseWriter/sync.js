/**
 * SupabaseWriter — Writes __MACRO_DATA__ to Supabase in correct table order.
 */

import { upsert, fetchOne } from './skills/upsert.js';

export class SupabaseWriter {
  async sync(macroData, runDate) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (process.env.SKIP_SUPABASE === 'true') {
      console.log('[SupabaseWriter] SKIP_SUPABASE=true — skipping all writes.');
      return;
    }

    if (!supabaseUrl || !serviceKey) {
      throw new Error('[SupabaseWriter] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    }

    const start = Date.now();
    const results = {};

    // 1. Upsert dashboard_runs
    console.log('[SupabaseWriter] 1/8: dashboard_runs');
    results.dashboard_runs = await upsert('dashboard_runs', {
      run_date: runDate,
      generated_at: macroData.generated_at,
      snap_verdict: macroData.snap_verdict,
      snap_india: macroData.snap_india,
      snap_global: macroData.snap_global,
      snap_risk: macroData.snap_risk,
      s1_badge: macroData.s1_badge,
      scenario_base_prob: 0,
      scenario_bull_prob: 0,
      scenario_bear_prob: 0,
      scenario_base_name: macroData.scenario_base?.name || '',
      scenario_base_desc: macroData.scenario_base?.description || '',
      scenario_bull_name: macroData.scenario_bull?.name || '',
      scenario_bull_desc: macroData.scenario_bull?.description || '',
      scenario_bear_name: macroData.scenario_bear?.name || '',
      scenario_bear_desc: macroData.scenario_bear?.description || '',
    }, supabaseUrl, serviceKey);

    // 2. Fetch run_id
    console.log('[SupabaseWriter] 2/8: Fetching run_id...');
    const runRow = await fetchOne(
      'dashboard_runs',
      `run_date=eq.${runDate}&select=id`,
      supabaseUrl,
      serviceKey
    );
    if (!runRow) throw new Error(`[SupabaseWriter] No dashboard_runs row for ${runDate}`);
    const runId = runRow.id;
    console.log(`[SupabaseWriter] run_id: ${runId}`);

    // 3. Regime classification
    console.log('[SupabaseWriter] 3/8: regime_classification');
    const regimeRows = (macroData.regime || []).map(r => ({
      run_id: runId,
      run_date: runDate,
      dimension: r.dimension,
      metric_summary: r.metric_summary,
      signal_text: r.signal_text,
      badge_label: r.badge_label,
      badge_type: r.badge_type,
    }));
    results.regime = await upsert('regime_classification', regimeRows, supabaseUrl, serviceKey);

    // 4. Signal cards
    console.log('[SupabaseWriter] 4/8: signal_cards');
    const signalRows = (macroData.signals || []).map(s => ({
      run_id: runId,
      run_date: runDate,
      signal_num: s.signal_num,
      signal_theme: s.signal_theme,
      status: s.status,
      title: s.title,
      data_text: s.data_text,
      implication: s.implication,
      pct_10y: s.pct_10y,
      pct_note: s.pct_note,
      is_surprise: s.is_surprise,
    }));
    results.signals = await upsert('signal_cards', signalRows, supabaseUrl, serviceKey);

    // 5. News feed
    console.log('[SupabaseWriter] 5/8: news_feed');
    const newsRows = (macroData.news || []).map(n => ({
      run_id: runId,
      run_date: runDate,
      category: n.category,
      headline: n.headline,
      url: n.url,
      source_name: n.source_name,
      buzz_tag: n.buzz_tag,
    }));
    results.news = await upsert('news_feed', newsRows, supabaseUrl, serviceKey);

    // 6. Macro indicators (chunked)
    console.log('[SupabaseWriter] 6/8: macro_indicators');
    const indicatorRows = (macroData.indicators || []).map(ind => ({
      run_id: runId,
      run_date: runDate,
      indicator_slug: ind.indicator_slug,
      label: ind.label,
      value: ind.value,
      value_str: ind.value_str,
      previous: ind.previous,
      change_pct: ind.change_pct,
      direction: ind.direction,
      momentum_label: ind.momentum_label,
      pct_10y: ind.pct_10y,
      pct_10y_tier: ind.pct_10y_tier,
      pct_note: ind.pct_note,
      source: ind.source,
      vintage: ind.vintage,
      is_estimated: ind.is_estimated,
    }));
    results.indicators = await upsert('macro_indicators', indicatorRows, supabaseUrl, serviceKey);

    // 7. Executive summary
    console.log('[SupabaseWriter] 7/8: executive_summary');
    const execRows = (macroData.executive_summary || []).map(p => ({
      run_id: runId,
      run_date: runDate,
      para_num: p.para_num,
      para_label: p.para_label,
      para_html: p.para_html,
    }));
    results.exec_summary = await upsert('executive_summary', execRows, supabaseUrl, serviceKey);

    // 8. Real estate summary
    console.log('[SupabaseWriter] 8/8: real_estate_summary');
    if (macroData.real_estate) {
      results.real_estate = await upsert('real_estate_summary', {
        run_id: runId,
        run_date: runDate,
        residential: JSON.stringify(macroData.real_estate.residential || {}),
        commercial: JSON.stringify(macroData.real_estate.commercial || {}),
      }, supabaseUrl, serviceKey);
    }

    const latency = Date.now() - start;
    console.log(`[SupabaseWriter] All 8 tables written in ${latency}ms.`);

    return results;
  }
}

if (process.argv[1] && process.argv[1].includes('SupabaseWriter')) {
  console.log('[SupabaseWriter] Standalone mode requires piped macroData JSON.');
}
