/**
 * SupabaseWriter — Writes pipeline output to Supabase in correct table order.
 * Column names match schema v1.0.0 (2026-03-24).
 */

import { upsert, fetchOne } from './skills/upsert.js';
import { filterChangedRows, recordSnapshot } from '../../../src/utils/data-cache.js';

/** Fallback IST time when run.ist_time is missing */
function getISTTime() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = String(ist.getHours()).padStart(2, '0');
  const m = String(ist.getMinutes()).padStart(2, '0');
  return `${h}:${m} IST`;
}

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

    // ── 1. dashboard_runs ────────────────────────────────────────────
    console.log('[SupabaseWriter] 1/8: dashboard_runs');

    // macroDataObj is nested: { run: {...}, regime: [...], indicators: [...], ... }
    const run = macroData.run || {};

    results.dashboard_runs = await upsert('dashboard_runs', {
      run_date:           runDate,
      generated_at:       new Date().toISOString(),
      ist_time:           run.ist_time || getISTTime(),
      snap_verdict:       run.snap_verdict       || '',
      snap_india:         run.snap_india         || '',
      snap_global:        run.snap_global        || '',
      snap_risk:          run.snap_risk          || '',
      india_regime:       run.india_regime       || '',
      global_regime:      run.global_regime      || '',
      scenario_base_prob: run.scenario_base_prob || 0,
      scenario_base_name: run.scenario_base_name || '',
      scenario_base_txt:  run.scenario_base_txt  || '',
      scenario_bull_prob: run.scenario_bull_prob || 0,
      scenario_bull_name: run.scenario_bull_name || '',
      scenario_bull_txt:  run.scenario_bull_txt  || '',
      scenario_bear_prob: run.scenario_bear_prob || 0,
      scenario_bear_name: run.scenario_bear_name || '',
      scenario_bear_txt:  run.scenario_bear_txt  || '',
      html_file_path:     macroData.html_file_path || '',
    }, supabaseUrl, serviceKey, 'run_date');

    // ── 2. Fetch run_id ──────────────────────────────────────────────
    console.log('[SupabaseWriter] 2/8: Fetching run_id...');
    const runRow = await fetchOne(
      'dashboard_runs',
      `run_date=eq.${runDate}&select=id`,
      supabaseUrl,
      serviceKey
    );
    if (!runRow) throw new Error(`[SupabaseWriter] No dashboard_runs row found for ${runDate}`);
    const runId = runRow.id;
    console.log(`[SupabaseWriter] run_id: ${runId}`);

    // ── 3. regime_classification ─────────────────────────────────────
    console.log('[SupabaseWriter] 3/8: regime_classification');
    const regimeRows = (macroData.regime || []).map(r => ({
      run_id:         runId,
      run_date:       runDate,
      dimension:      r.dimension,
      metric_summary: r.metric_summary,
      signal_text:    r.signal_text,
      badge_label:    r.badge_label,
      badge_type:     r.badge_type,
    }));
    const regimeKey = (r) => `${r.run_date}:${r.dimension}`;
    const { changed: changedRegime, skipped: skippedRegime } = filterChangedRows('regime_classification', regimeRows, regimeKey);
    if (changedRegime.length > 0) {
      results.regime = await upsert('regime_classification', changedRegime, supabaseUrl, serviceKey, 'run_date,dimension');
      recordSnapshot('regime_classification', changedRegime, regimeKey);
    } else {
      results.regime = { table: 'regime_classification', totalRows: 0, chunks: 0, allSuccess: true };
    }
    console.log(`[SupabaseWriter] regime: ${changedRegime.length} changed, ${skippedRegime} skipped`);

    // ── 4. signal_cards ──────────────────────────────────────────────
    console.log('[SupabaseWriter] 4/8: signal_cards');
    const signalRows = (macroData.signals || []).map(s => ({
      run_id:       runId,
      run_date:     runDate,
      signal_num:   s.signal_num,
      signal_theme: s.signal_theme,
      status:       s.status,
      title:        s.title,
      data_text:    s.data_text,
      implication:  s.implication,
      pct_10y:      s.pct_10y,
      pct_note:     s.pct_note,
      is_surprise:  s.is_surprise,
    }));
    const sigKey = (r) => `${r.run_date}:${r.signal_num}`;
    const { changed: changedSigs, skipped: skippedSigs } = filterChangedRows('signal_cards', signalRows, sigKey);
    if (changedSigs.length > 0) {
      results.signals = await upsert('signal_cards', changedSigs, supabaseUrl, serviceKey, 'run_date,signal_num');
      recordSnapshot('signal_cards', changedSigs, sigKey);
    } else {
      results.signals = { table: 'signal_cards', totalRows: 0, chunks: 0, allSuccess: true };
    }
    console.log(`[SupabaseWriter] signals: ${changedSigs.length} changed, ${skippedSigs} skipped`);

    // ── 5. news_feed ─────────────────────────────────────────────────
    console.log('[SupabaseWriter] 5/8: news_feed');
    const newsRows = (macroData.news || []).map(n => ({
      run_id:      runId,
      run_date:    runDate,
      category:    n.category,
      headline:    n.headline,
      url:         n.url,
      source_name: n.source_name,
      buzz_tag:    n.buzz_tag,
    }));
    const newsKey = (r) => `${r.run_date}:${r.category}`;
    const { changed: changedNews, skipped: skippedNews } = filterChangedRows('news_feed', newsRows, newsKey);
    if (changedNews.length > 0) {
      results.news = await upsert('news_feed', changedNews, supabaseUrl, serviceKey, 'run_date,category');
      recordSnapshot('news_feed', changedNews, newsKey);
    } else {
      results.news = { table: 'news_feed', totalRows: 0, chunks: 0, allSuccess: true };
    }
    console.log(`[SupabaseWriter] news: ${changedNews.length} changed, ${skippedNews} skipped`);

    // ── 6. macro_indicators (deduped + chunked) ───────────────────────
    console.log('[SupabaseWriter] 6/8: macro_indicators');
    const indicatorRows = (macroData.indicators || []).map(ind => ({
      run_id:           runId,
      run_date:         runDate,
      section:          ind.section         || 'S9',
      sub_section:      ind.sub_section     || 'unknown',
      indicator_name:   ind.indicator_name  || ind.indicator_slug,
      indicator_slug:   ind.indicator_slug,
      latest_value:     ind.latest_value    || 'Awaited',
      latest_numeric:   ind.latest_numeric  ?? null,
      latest_unit:      ind.latest_unit     || '',
      previous_value:   ind.previous_value  ?? null,
      previous_numeric: ind.previous_numeric ?? null,
      data_vintage:     ind.data_vintage    || 'Awaited',
      direction:        ind.direction       || 'flat',
      momentum_label:   ind.momentum_label  || '',
      pct_10y:          ind.pct_10y         ?? 50,
      pct_10y_tier:     ind.pct_10y_tier    || 'mid',
      pct_note:         ind.pct_note        || '',
      is_estimated:     ind.is_estimated    || false,
      source:           ind.source          || '',
    }));
    const indKey = (r) => `${r.run_date}:${r.indicator_slug}`;
    const { changed: changedInds, skipped: skippedInds } = filterChangedRows('macro_indicators', indicatorRows, indKey);
    if (changedInds.length > 0) {
      results.indicators = await upsert('macro_indicators', changedInds, supabaseUrl, serviceKey, 'run_date,indicator_slug');
      recordSnapshot('macro_indicators', changedInds, indKey);
    } else {
      results.indicators = { table: 'macro_indicators', totalRows: 0, chunks: 0, allSuccess: true };
    }
    console.log(`[SupabaseWriter] macro_indicators: ${changedInds.length} changed, ${skippedInds} unchanged (skipped)`);

    // ── 7. executive_summary ─────────────────────────────────────────
    console.log('[SupabaseWriter] 7/8: executive_summary');
    const execRows = (macroData.executive_summary || []).map(p => ({
      run_id:     runId,
      run_date:   runDate,
      para_num:   p.para_num,
      para_label: p.para_label,
      para_html:  p.para_html,
    }));
    const execKey = (r) => `${r.run_date}:${r.para_num}`;
    const { changed: changedExec, skipped: skippedExec } = filterChangedRows('executive_summary', execRows, execKey);
    if (changedExec.length > 0) {
      results.exec_summary = await upsert('executive_summary', changedExec, supabaseUrl, serviceKey, 'run_date,para_num');
      recordSnapshot('executive_summary', changedExec, execKey);
    } else {
      results.exec_summary = { table: 'executive_summary', totalRows: 0, chunks: 0, allSuccess: true };
    }
    console.log(`[SupabaseWriter] exec_summary: ${changedExec.length} changed, ${skippedExec} skipped`);

    // ── 8. real_estate_summary ───────────────────────────────────────
    console.log('[SupabaseWriter] 8/8: real_estate_summary');
    if (macroData.real_estate) {
      const re = macroData.real_estate;
      const reRow = {
        run_id:                  runId,
        run_date:                runDate,
        re_summary_text:         re.re_summary_text         || '',
        residential_regime:      re.residential_regime      || '',
        commercial_regime:       re.commercial_regime       || '',
        reit_vs_gsec_spread_bps: re.reit_vs_gsec_spread_bps ?? null,
        key_risk_note:           re.key_risk_note           || '',
      };
      const reKey = (r) => r.run_date;
      const { changed: changedRE } = filterChangedRows('real_estate_summary', [reRow], reKey);
      if (changedRE.length > 0) {
        results.real_estate = await upsert('real_estate_summary', reRow, supabaseUrl, serviceKey, 'run_date');
        recordSnapshot('real_estate_summary', [reRow], reKey);
      } else {
        results.real_estate = { table: 'real_estate_summary', totalRows: 0, chunks: 0, allSuccess: true };
        console.log(`[SupabaseWriter] real_estate: unchanged, skipped`);
      }
    }

    // ── Summary ─────────────────────────────────────────────────────
    const totalPushed = [changedRegime, changedSigs, changedNews, changedInds, changedExec].reduce((s, a) => s + a.length, 0);
    const totalSkipped = skippedRegime + skippedSigs + skippedNews + skippedInds + skippedExec;
    const latency = Date.now() - start;
    console.log(`[SupabaseWriter] Done in ${latency}ms — ${totalPushed} rows pushed, ${totalSkipped} unchanged rows skipped.`);
    return results;
  }
}
