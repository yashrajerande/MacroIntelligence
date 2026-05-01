/**
 * Conglomerates HTML renderer. Self-contained light-mode page that matches
 * the MacroIntelligence aesthetic: Syne + DM Mono, deep indigo accent.
 * Pure code — no LLM. The Advisor's JSON is authoritative.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = join(__dirname, '..', '..', '..', 'output', 'conglomerates');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function deltaBadge(d) {
  if (d == null || d === 0) return '<span class="delta flat">·</span>';
  if (d > 0)  return `<span class="delta up">+${d}</span>`;
  return `<span class="delta down">${d}</span>`;
}

function row(cells, cls = '') {
  return `<tr class="${cls}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
}

function tableMoves(moves) {
  if (!moves?.length) {
    return `<p class="empty">No material movement across the universe this cycle.</p>`;
  }
  const head = `<tr><th>Group</th><th>Move</th><th>Strategic Interpretation</th></tr>`;
  const body = moves.map(m => row([esc(m.group), esc(m.move), esc(m.interpretation)])).join('');
  return `<table class="moves">${head}${body}</table>`;
}

function tablePowerDashboard(rows) {
  const head = `<tr><th>Group</th><th>Vision</th><th>Talent</th><th>Exec</th><th>Trust</th><th>Access</th><th>Edge</th><th>Capital</th></tr>`;
  const cell = c => `${c?.score ?? '—'} ${deltaBadge(c?.delta)}`;
  const body = rows.map(r => row([
    `<strong>${esc(r.group)}</strong>`,
    cell(r.vision), cell(r.talent), cell(r.exec),
    cell(r.trust), cell(r.access), cell(r.edge), cell(r.capital),
  ])).join('');
  return `<table class="dash">${head}${body}</table>`;
}

function tablePowerMap(rows) {
  const head = `<tr><th>Group</th><th>Political</th><th>Capital Markets</th><th>Control Stability</th><th>Global</th><th>AI / Energy</th></tr>`;
  const body = rows.map(r => row([
    `<strong>${esc(r.group)}</strong>`,
    esc(r.political), esc(r.capital_markets), esc(r.control_stability), esc(r.global), esc(r.ai_energy),
  ])).join('');
  return `<table class="dash">${head}${body}</table>`;
}

function tableScored(rows, scoreLabel, commentaryKey) {
  const head = `<tr><th>Group</th><th>${scoreLabel}</th><th>${commentaryKey === 'why' ? 'Why' : commentaryKey === 'commentary' ? 'Commentary' : 'Interpretation'}</th></tr>`;
  const body = rows.map(r => row([
    `<strong>${esc(r.group)}</strong>`,
    esc(r.score),
    esc(r[commentaryKey] || r.interpretation || r.why || r.commentary),
  ])).join('');
  return `<table class="dash">${head}${body}</table>`;
}

function tableControlMap(rows) {
  const head = `<tr><th>Group</th><th>Promoter</th><th>Succession</th><th>Board</th><th>Partners</th><th>Political</th></tr>`;
  const body = rows.map(r => row([
    `<strong>${esc(r.group)}</strong>`,
    esc(r.promoter), esc(r.succession), esc(r.board), esc(r.partners), esc(r.political),
  ])).join('');
  return `<table class="dash">${head}${body}</table>`;
}

function rankingBlock(ranking) {
  const tiers = [
    { key: 'tier1', label: 'Tier 1 — System Dominators' },
    { key: 'tier2', label: 'Tier 2 — Strategic Challengers' },
    { key: 'tier3', label: 'Tier 3 — Stable Compounders' },
    { key: 'tier4', label: 'Tier 4 — Fragile / Declining' },
  ];
  return tiers.map(t => {
    const items = (ranking?.[t.key] || []).map(r =>
      `<li><strong>${esc(r.group)}</strong> — ${esc(r.rationale)}</li>`,
    ).join('');
    return `<div class="tier"><h3>${esc(t.label)}</h3><ul>${items || '<li class="empty">—</li>'}</ul></div>`;
  }).join('');
}

function typologyBlock(typology) {
  const buckets = [
    ['platform_empires',       'Platform Empires'],
    ['institutional_builders', 'Institutional Builders'],
    ['industrial_scalers',     'Industrial Scalers'],
    ['capital_allocators',     'Capital Allocators'],
    ['southern_compounders',   'Southern Compounders'],
    ['fragile_leveraged',      'Fragile / Leveraged'],
  ];
  return buckets.map(([k, label]) => {
    const groups = (typology?.[k] || []).map(g => `<span class="chip">${esc(g)}</span>`).join('');
    return `<div class="typology-bucket"><h4>${esc(label)}</h4><div>${groups || '<span class="empty">—</span>'}</div></div>`;
  }).join('');
}

function redFlagsBlock(flags) {
  if (!flags?.length) return `<p class="empty">No red flags raised this cycle.</p>`;
  return `<ul class="red-flags">${flags.map(f =>
    `<li><strong>${esc(f.group)}</strong> — ${esc(f.flag)}</li>`,
  ).join('')}</ul>`;
}

function themesBlock(themes) {
  if (!themes?.length) return '';
  return `<ul class="themes">${themes.map(t =>
    `<li><strong>${esc(t.title)}</strong> — ${esc(t.thesis)}</li>`,
  ).join('')}</ul>`;
}

function bottomLineBlock(bullets) {
  if (!bullets?.length) return '';
  return `<ul class="bottom-line">${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;
}

const CSS = `
:root{--ink:#0a0a14;--paper:#fafaf7;--muted:#6b6b78;--accent:#1a00cc;--rule:#e6e6e0;--up:#0a8a3a;--down:#b00020;--flat:#9a9aa6;}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'DM Mono',ui-monospace,monospace;font-size:13.5px;line-height:1.55;}
header{padding:32px 40px 16px;border-bottom:1px solid var(--rule);}
h1{font-family:'Syne',ui-sans-serif,system-ui;font-weight:700;font-size:32px;margin:0 0 4px;letter-spacing:-0.01em;}
h2{font-family:'Syne',ui-sans-serif,system-ui;font-weight:600;font-size:18px;letter-spacing:0.02em;text-transform:uppercase;margin:36px 0 12px;color:var(--accent);}
h3{font-family:'Syne',ui-sans-serif,system-ui;font-weight:600;font-size:15px;margin:18px 0 8px;}
h4{font-family:'Syne',ui-sans-serif,system-ui;font-weight:600;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;color:var(--muted);margin:0 0 8px;}
.meta{color:var(--muted);font-size:12px;}
main{padding:24px 40px 80px;max-width:1280px;margin:0 auto;}
section{margin-bottom:32px;}
table{border-collapse:collapse;width:100%;font-size:12.5px;}
th,td{border-bottom:1px solid var(--rule);padding:8px 10px;text-align:left;vertical-align:top;}
th{font-family:'Syne',ui-sans-serif,system-ui;font-weight:600;font-size:11.5px;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted);}
.delta{font-size:10.5px;padding:1px 5px;border-radius:3px;margin-left:4px;}
.delta.up{background:rgba(10,138,58,.1);color:var(--up);}
.delta.down{background:rgba(176,0,32,.1);color:var(--down);}
.delta.flat{color:var(--flat);}
.tier{margin-bottom:14px;}
.tier ul{margin:0;padding-left:18px;}
.typology{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
.typology-bucket{border:1px solid var(--rule);border-radius:6px;padding:12px;}
.chip{display:inline-block;background:#fff;border:1px solid var(--rule);border-radius:14px;padding:2px 10px;margin:2px 4px 2px 0;font-size:11.5px;}
.red-flags li{margin-bottom:6px;}
.bottom-line{border-left:3px solid var(--accent);padding-left:14px;}
.empty{color:var(--muted);font-style:italic;}
nav.tabs{position:sticky;top:0;background:var(--paper);border-bottom:1px solid var(--rule);padding:10px 40px;display:flex;gap:18px;font-family:'Syne',ui-sans-serif,system-ui;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;}
nav.tabs a{color:var(--muted);text-decoration:none;padding-bottom:4px;border-bottom:2px solid transparent;}
nav.tabs a.active{color:var(--accent);border-bottom-color:var(--accent);}
nav.tabs a:hover{color:var(--ink);}
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@500;600;700&family=DM+Mono:wght@400;500&display=swap');
`;

export function renderHTML({ data, cycleLabel, runDate, isoMonth, outDir = DEFAULT_OUT_DIR }) {
  const sections = `
    <section><h2>1 · Major Strategic Moves (Last 30-60 days)</h2>${tableMoves(data.moves || [])}</section>
    <section><h2>2 · Strategic Power Dashboard</h2>${tablePowerDashboard(data.power_dashboard || [])}</section>
    <section><h2>3 · Strategic Power Map</h2>${tablePowerMap(data.power_map || [])}</section>
    <section><h2>4 · Debt Wall / Fragility Overlay</h2>${tableScored(data.debt_wall || [], 'Risk', 'interpretation')}</section>
    <section><h2>5 · Execution Receipts</h2>${tableScored(data.execution_receipts || [], 'Score', 'commentary')}</section>
    <section><h2>6 · Momentum Score</h2>${tableScored(data.momentum || [], 'Score', 'why')}</section>
    <section><h2>7 · Future Dominance Index</h2>${tableScored(data.future_dominance || [], 'Score', 'why')}</section>
    <section><h2>8 · Conglomerate Control Map</h2>${tableControlMap(data.control_map || [])}</section>
    <section><h2>9 · Ranking</h2>${rankingBlock(data.ranking || {})}</section>
    <section><h2>10 · Typology</h2><div class="typology">${typologyBlock(data.typology || {})}</div></section>
    <section><h2>11 · Red Flags</h2>${redFlagsBlock(data.red_flags || [])}</section>
    <section><h2>12 · Emerging Themes</h2>${themesBlock(data.emerging_themes || [])}</section>
    <section><h2>13 · Bottom-Line View</h2>${bottomLineBlock(data.bottom_line || [])}</section>
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conglomerates Tracker — ${esc(cycleLabel)}</title>
<style>${CSS}</style>
</head>
<body>
<nav class="tabs">
  <a href="../index.html">Daily Macro</a>
  <a href="./index.html" class="active">Conglomerates</a>
</nav>
<header>
  <h1>Conglomerates Tracker — ${esc(cycleLabel)}</h1>
  <div class="meta">Indian Conglomerates Strategic Intelligence System · Window ${esc(data.window_start)} → ${esc(data.window_end)} · Generated ${esc(runDate)}</div>
</header>
<main>${sections}</main>
</body>
</html>`;

  mkdirSync(outDir, { recursive: true });
  const archivePath = join(outDir, `conglomerates-${isoMonth}.html`);
  const latestPath = join(outDir, 'index.html');
  writeFileSync(archivePath, html);
  writeFileSync(latestPath, html);

  return { archivePath, latestPath, sizeBytes: Buffer.byteLength(html) };
}
