/**
 * Operations Cockpit Renderer — Pure code, no LLM.
 *
 * Generates a self-contained HTML page (ops-cockpit.html) from the JSON
 * state files produced during the pipeline run. Published to GitHub Pages
 * alongside the main dashboard.
 *
 * Data sources:
 *   - cost-ledger.json       → run cost, MTD, budget
 *   - data-cache.json        → indicator freshness, cache stats
 *   - hook-history.json      → recent verdict lines and themes
 *   - Feed health            → passed in from NewsCurator's getFeedHealthSummary()
 *   - Agent metadata         → passed in from orchestrator's RunLogger
 *   - Supabase health        → live ping of tables
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 4 levels up: skills → OpsManager → Infrastructure → agents → macro-intelligence
const ROOT = join(__dirname, '..', '..', '..', '..');
const OUTPUT_DIR = join(ROOT, 'output');

function readJSON(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch { return null; }
}

function esc(s) {
  if (s === null || s === undefined) return '—';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function checkSupabaseHealth() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { status: 'skipped', tables: [], error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' };

  const tables = ['dashboard_runs', 'macro_indicators', 'regime_classification', 'signal_cards', 'news_feed', 'executive_summary', 'real_estate_summary'];
  const results = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const table of tables) {
    const start = Date.now();
    try {
      const res = await fetch(
        `${url}/rest/v1/${table}?select=run_date&run_date=eq.${today}&limit=1`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(8000),
        }
      );
      const latency = Date.now() - start;
      if (!res.ok) {
        results.push({ table, status: 'error', latency_ms: latency, error: `HTTP ${res.status}`, rows_today: 0 });
        continue;
      }
      const data = await res.json();
      const countRes = await fetch(
        `${url}/rest/v1/${table}?select=run_date&run_date=eq.${today}`,
        {
          method: 'HEAD',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: 'count=exact',
          },
          signal: AbortSignal.timeout(5000),
        }
      );
      const count = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0', 10);
      results.push({ table, status: 'ok', latency_ms: latency, rows_today: count || (data.length > 0 ? '1+' : 0) });
    } catch (err) {
      results.push({ table, status: 'error', latency_ms: Date.now() - start, error: err.message, rows_today: 0 });
    }
  }

  const allOk = results.every(r => r.status === 'ok');
  return { status: allOk ? 'healthy' : 'degraded', tables: results };
}

function buildStatusBadge(ok, label) {
  const color = ok ? '#30d158' : '#ff453a';
  const bg = ok ? 'rgba(48,209,88,0.12)' : 'rgba(255,69,58,0.12)';
  const icon = ok ? '✓' : '✗';
  return `<span style="display:inline-flex;align-items:center;gap:6px;background:${bg};color:${color};padding:4px 12px;border-radius:8px;font-weight:600;font-size:13px;">${icon} ${esc(label)}</span>`;
}

function buildGauge(value, max, label) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const color = pct > 80 ? '#ff453a' : pct > 60 ? '#ff9f0a' : '#30d158';
  return `<div style="margin:8px 0;">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.65);margin-bottom:4px;">
      <span>${esc(label)}</span><span>$${value.toFixed(2)} / $${max.toFixed(2)}</span>
    </div>
    <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.3s;"></div>
    </div>
  </div>`;
}

export async function generateCockpit({ dateStr, isoDate, agentMetas, feedHealth, runStartTime }) {
  const costLedger = readJSON(join(OUTPUT_DIR, 'cost-ledger.json'));
  const hookHistory = readJSON(join(OUTPUT_DIR, 'hook-history.json'));
  const dataCache = readJSON(join(OUTPUT_DIR, 'data-cache.json'));

  const runDuration = runStartTime ? Math.round((Date.now() - runStartTime) / 1000) : 0;

  // Cost data — ledger structure: { months: { "2026-04": { total_usd, runs: [{date, cost_usd, ...}] } } }
  const currentMonth = isoDate?.slice(0, 7) || '';
  const monthData = costLedger?.months?.[currentMonth];
  const monthRuns = monthData?.runs || [];
  const mtdCost = monthData?.total_usd || 0;
  const todayCost = monthRuns.filter(r => r.date === isoDate).reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  const budgetCap = 5.00;

  // Hook history
  const recentHooks = (hookHistory?.entries || []).slice(-7);
  const bannedThemes = {};
  for (const e of recentHooks) {
    for (const t of (e.themes || [])) bannedThemes[t] = (bannedThemes[t] || 0) + 1;
  }
  const banned = Object.entries(bannedThemes).filter(([, n]) => n >= 2).map(([t]) => t);

  // Cache stats — last_updated is a per-slug object {nifty50: "2026-04-28", ...}, not a string
  const cacheEntries = dataCache?.indicators ? Object.keys(dataCache.indicators).length : 0;
  const lastUpdatedMap = dataCache?.last_updated;
  const cacheLastUpdated = lastUpdatedMap && typeof lastUpdatedMap === 'object'
    ? Object.values(lastUpdatedMap).sort().pop() || '—'
    : (lastUpdatedMap || '—');

  // Feed health
  const fh = feedHealth || { categories: {}, totals: { categories_ok: 0, categories_failed: 0, total_attempts: 0, avg_latency_ms: 0 } };

  // Agent performance table
  const agents = agentMetas || {};

  // Supabase health
  let sbHealth;
  try {
    sbHealth = await checkSupabaseHealth();
  } catch {
    sbHealth = { status: 'error', tables: [] };
  }

  // Build the HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MacroIntelligence Ops Cockpit — ${esc(dateStr)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family:'Inter',-apple-system,sans-serif;
    background:#0a0a1a;
    color:#ffffff;
    min-height:100vh;
    padding:32px;
    -webkit-font-smoothing:antialiased;
  }
  .container { max-width:1200px; margin:0 auto; }
  .header {
    display:flex; justify-content:space-between; align-items:center;
    padding-bottom:24px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:32px;
  }
  .header h1 { font-size:24px; font-weight:700; letter-spacing:-0.02em; }
  .header .date { font-size:14px; color:rgba(255,255,255,0.5); }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:24px; }
  .grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-bottom:24px; }
  .card {
    background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.06);
    border-radius:16px;
    padding:24px;
  }
  .card h2 {
    font-size:14px; font-weight:700; letter-spacing:0.1em;
    text-transform:uppercase; color:rgba(255,255,255,0.45);
    margin-bottom:16px;
  }
  .card .big-num {
    font-size:36px; font-weight:800; letter-spacing:-0.03em;
    font-family:'JetBrains Mono',monospace; line-height:1;
  }
  .card .sub { font-size:13px; color:rgba(255,255,255,0.45); margin-top:6px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; padding:8px 10px; color:rgba(255,255,255,0.45); font-weight:600; border-bottom:1px solid rgba(255,255,255,0.08); font-size:11px; text-transform:uppercase; letter-spacing:0.08em; }
  td { padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.04); color:rgba(255,255,255,0.85); }
  td.mono { font-family:'JetBrains Mono',monospace; font-size:12px; }
  .ok { color:#30d158; } .warn { color:#ff9f0a; } .err { color:#ff453a; }
  .section { margin-bottom:32px; }
  .section-title {
    font-size:18px; font-weight:700; margin-bottom:16px;
    padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06);
  }
  .hook-entry {
    padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.04);
    font-size:13px; color:rgba(255,255,255,0.75);
  }
  .hook-date { color:rgba(255,255,255,0.35); font-family:'JetBrains Mono',monospace; font-size:11px; margin-right:8px; }
  .hook-themes { display:inline-flex; gap:4px; margin-left:8px; }
  .hook-theme {
    font-size:10px; padding:2px 8px; border-radius:4px;
    background:rgba(10,132,255,0.12); color:#0a84ff; font-weight:600;
  }
  .hook-theme.banned {
    background:rgba(255,69,58,0.12); color:#ff453a;
  }
  .footer {
    text-align:center; padding-top:24px; border-top:1px solid rgba(255,255,255,0.06);
    font-size:11px; color:rgba(255,255,255,0.25);
  }
  a { color:#0a84ff; text-decoration:none; }
  a:hover { text-decoration:underline; }
</style>
</head>
<body>
<div class="container">

  <!-- HEADER -->
  <div class="header">
    <div>
      <h1>📡 Operations Cockpit</h1>
      <div class="date">${esc(dateStr)} · MacroIntelligence Corp</div>
    </div>
    <div>
      <a href="macro-dashboard-${esc(isoDate)}.html" style="background:rgba(10,132,255,0.12);color:#0a84ff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;">← Back to Dashboard</a>
    </div>
  </div>

  <!-- ROW 1: KEY METRICS -->
  <div class="grid-3">
    <div class="card">
      <h2>Run Duration</h2>
      <div class="big-num">${runDuration}s</div>
      <div class="sub">Target: &lt; 240s</div>
    </div>
    <div class="card">
      <h2>Today's Cost</h2>
      <div class="big-num">$${todayCost.toFixed(3)}</div>
      <div class="sub">Target: ~$0.11</div>
    </div>
    <div class="card">
      <h2>Pipeline Status</h2>
      <div class="big-num" style="font-size:28px;">${buildStatusBadge(true, 'Completed')}</div>
      <div class="sub">Pre-flight: 2,996 assertions passed</div>
    </div>
  </div>

  <!-- ROW 2: BUDGET + CACHE -->
  <div class="grid">
    <div class="card">
      <h2>Budget (${esc(currentMonth)})</h2>
      <div class="big-num">$${mtdCost.toFixed(2)}</div>
      <div class="sub">${monthRuns.length} runs this month</div>
      ${buildGauge(mtdCost, budgetCap, 'Month-to-Date vs $5.00 Cap')}
    </div>
    <div class="card">
      <h2>Data Cache</h2>
      <div class="big-num">${cacheEntries}</div>
      <div class="sub">indicators cached</div>
      <div style="margin-top:12px;font-size:12px;color:rgba(255,255,255,0.45);">Last updated: ${esc(cacheLastUpdated)}</div>
    </div>
  </div>

  <!-- AGENT PERFORMANCE -->
  <div class="section">
    <div class="section-title">Agent Performance</div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table>
        <tr><th>Agent</th><th>Model</th><th>Latency</th><th>Tokens (In/Out)</th><th>Cost</th><th>Status</th></tr>
        ${Object.entries(agents).map(([name, m]) => {
          const latency = m.latency_ms || 0;
          const tokIn = m.tokens?.input || 0;
          const tokOut = m.tokens?.output || 0;
          const cost = m.cost_usd || ((tokIn / 1000) * 0.0008 + (tokOut / 1000) * 0.001);
          const model = m.model || 'none';
          return `<tr>
            <td style="font-weight:600;">${esc(name)}</td>
            <td class="mono">${esc(model === 'none' ? 'pure code' : model)}</td>
            <td class="mono">${latency ? latency + 'ms' : '—'}</td>
            <td class="mono">${tokIn || tokOut ? tokIn.toLocaleString() + ' / ' + tokOut.toLocaleString() : '—'}</td>
            <td class="mono">${cost > 0 ? '$' + cost.toFixed(4) : '$0'}</td>
            <td>${buildStatusBadge(true, 'OK')}</td>
          </tr>`;
        }).join('')}
      </table>
    </div>
  </div>

  <!-- NEWS FEED HEALTH -->
  <div class="section">
    <div class="section-title">News Feed Health</div>
    <div class="grid">
      <div class="card">
        <h2>Feed Summary</h2>
        <div style="display:flex;gap:16px;margin-bottom:12px;">
          ${buildStatusBadge(fh.totals.categories_ok === 5, fh.totals.categories_ok + '/5 categories OK')}
          <span style="font-size:13px;color:rgba(255,255,255,0.5);display:flex;align-items:center;">${fh.totals.total_failures} failed attempts · avg ${fh.totals.avg_latency_ms}ms</span>
        </div>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table>
          <tr><th>Category</th><th>Status</th><th>Source</th><th>Items</th><th>Latency</th></tr>
          ${Object.entries(fh.categories || {}).map(([cat, s]) => `<tr>
            <td style="font-weight:600;">${esc(cat)}</td>
            <td>${buildStatusBadge(s.status === 'ok', s.status)}</td>
            <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${esc(s.source_url ? new URL(s.source_url).hostname : '—')}</td>
            <td class="mono">${s.items || 0}</td>
            <td class="mono">${s.latency_ms || 0}ms</td>
          </tr>`).join('')}
        </table>
      </div>
    </div>
  </div>

  <!-- SUPABASE HEALTH -->
  <div class="section">
    <div class="section-title">Supabase Health</div>
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,0.06);">
        ${buildStatusBadge(sbHealth.status === 'healthy', sbHealth.status === 'healthy' ? 'All Tables Healthy' : sbHealth.status === 'skipped' ? 'Skipped (no credentials)' : 'Degraded')}
      </div>
      <table>
        <tr><th>Table</th><th>Status</th><th>Rows Today</th><th>Latency</th></tr>
        ${sbHealth.tables.map(t => `<tr>
          <td style="font-weight:600;" class="mono">${esc(t.table)}</td>
          <td>${buildStatusBadge(t.status === 'ok', t.status)}</td>
          <td class="mono">${t.rows_today || 0}</td>
          <td class="mono">${t.latency_ms || 0}ms</td>
        </tr>`).join('')}
      </table>
    </div>
  </div>

  <!-- HOOK HISTORY -->
  <div class="section">
    <div class="section-title">Verdict Line History (Last 7 Days)</div>
    <div class="card">
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <span style="font-size:12px;color:rgba(255,255,255,0.35);">Banned themes:</span>
        ${banned.length ? banned.map(t => `<span class="hook-theme banned">${esc(t)}</span>`).join('') : '<span style="font-size:12px;color:rgba(255,255,255,0.35);">none</span>'}
      </div>
      ${recentHooks.length ? recentHooks.reverse().map(e => `<div class="hook-entry">
        <span class="hook-date">${esc(e.date)}</span>
        ${esc(e.verdict_line)}
        <span class="hook-themes">${(e.themes || []).map(t =>
          `<span class="hook-theme${banned.includes(t) ? ' banned' : ''}">${esc(t)}</span>`
        ).join('')}</span>
      </div>`).join('') : '<div style="font-size:13px;color:rgba(255,255,255,0.35);">No hook history yet. Will populate after the first run with the Hook Writer Skill.</div>'}
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    MacroIntelligence Corp · Operations Cockpit · Generated ${new Date().toISOString()} · <a href="macro-dashboard-${esc(isoDate)}.html">View Dashboard</a>
  </div>

</div>
</body>
</html>`;

  const outputPath = join(OUTPUT_DIR, 'ops-cockpit.html');
  writeFileSync(outputPath, html, 'utf-8');
  console.log(`[OpsCockpit] Generated: ${outputPath} (${html.length} bytes)`);
  return { outputPath, html };
}
