/**
 * NotionPublisher — creates a sub-page under the MacroIntelligence org page
 * containing the cycle report rendered as native Notion blocks.
 *
 * Idempotent: if a page with the exact title already exists under the
 * parent, we archive the old page and create a fresh one (Notion API has
 * no in-place block-tree replace; archive+recreate is the canonical
 * idempotency pattern).
 *
 * Required env:
 *   NOTION_API_KEY         — internal integration token
 *   NOTION_PARENT_PAGE_ID  — id of the MacroIntelligence org page
 *
 * If either is missing, this publisher logs a warning and exits cleanly
 * without throwing — Notion is best-effort.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(key) {
  return {
    'Authorization': `Bearer ${key}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function notionFetch(path, options = {}, key) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: { ...notionHeaders(key), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.message || res.statusText;
    throw new Error(`Notion ${options.method || 'GET'} ${path} → ${res.status}: ${msg}`);
  }
  return body;
}

const rt = (text, opts = {}) => ({
  type: 'text',
  text: { content: String(text ?? '').slice(0, 1900) },
  annotations: {
    bold: !!opts.bold,
    italic: !!opts.italic,
    code: !!opts.code,
    color: opts.color || 'default',
  },
});

const heading = (level, text) => ({
  object: 'block',
  type: `heading_${level}`,
  [`heading_${level}`]: { rich_text: [rt(text)] },
});

const paragraph = (text, opts) => ({
  object: 'block',
  type: 'paragraph',
  paragraph: { rich_text: [rt(text, opts)] },
});

const bullet = text => ({
  object: 'block',
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: [rt(text)] },
});

const callout = (text, emoji = '⚠️') => ({
  object: 'block',
  type: 'callout',
  callout: {
    rich_text: [rt(text)],
    icon: { type: 'emoji', emoji },
    color: 'gray_background',
  },
});

const divider = () => ({ object: 'block', type: 'divider', divider: {} });

function buildTable(headers, rows) {
  const tableRows = [
    { object: 'block', type: 'table_row', table_row: { cells: headers.map(h => [rt(h)]) } },
    ...rows.map(r => ({
      object: 'block',
      type: 'table_row',
      table_row: { cells: r.map(c => [rt(c)]) },
    })),
  ];
  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: headers.length,
      has_column_header: true,
      has_row_header: true,
      children: tableRows,
    },
  };
}

function fmtScoreDelta(c) {
  if (c == null) return '—';
  const d = c.delta;
  const dStr = d == null || d === 0 ? '·' : d > 0 ? `+${d}` : `${d}`;
  return `${c.score ?? '—'} (${dStr})`;
}

function buildBlocks(data, cycleLabel) {
  const blocks = [];

  blocks.push(paragraph(
    `Indian Conglomerates Strategic Intelligence System · Window ${data.window_start} → ${data.window_end}`,
    { italic: true, color: 'gray' },
  ));
  blocks.push(divider());

  // 1. Major Strategic Moves
  blocks.push(heading(2, '1 · Major Strategic Moves (Last 30-60 days)'));
  if (!data.moves?.length) {
    blocks.push(callout('No material movement across the universe this cycle.', '🪶'));
  } else {
    blocks.push(buildTable(
      ['Group', 'Move', 'Strategic Interpretation'],
      data.moves.map(m => [m.group, m.move, m.interpretation]),
    ));
  }

  // 2. Power Dashboard
  blocks.push(heading(2, '2 · Strategic Power Dashboard'));
  blocks.push(buildTable(
    ['Group', 'Vision', 'Talent', 'Exec', 'Trust', 'Access', 'Edge', 'Capital'],
    (data.power_dashboard || []).map(r => [
      r.group, fmtScoreDelta(r.vision), fmtScoreDelta(r.talent), fmtScoreDelta(r.exec),
      fmtScoreDelta(r.trust), fmtScoreDelta(r.access), fmtScoreDelta(r.edge), fmtScoreDelta(r.capital),
    ]),
  ));

  // 3. Power Map
  blocks.push(heading(2, '3 · Strategic Power Map'));
  blocks.push(buildTable(
    ['Group', 'Political', 'Capital Markets', 'Control Stability', 'Global', 'AI / Energy'],
    (data.power_map || []).map(r => [
      r.group, String(r.political ?? '—'), String(r.capital_markets ?? '—'),
      String(r.control_stability ?? '—'), String(r.global ?? '—'), String(r.ai_energy ?? '—'),
    ]),
  ));

  // 4-7. Score+commentary tables
  const scoreTables = [
    ['4 · Debt Wall / Fragility Overlay', data.debt_wall, 'interpretation', 'Interpretation'],
    ['5 · Execution Receipts',            data.execution_receipts, 'commentary', 'Commentary'],
    ['6 · Momentum Score',                data.momentum, 'why', 'Why'],
    ['7 · Future Dominance Index',        data.future_dominance, 'why', 'Why'],
  ];
  for (const [title, rows, key, label] of scoreTables) {
    blocks.push(heading(2, title));
    blocks.push(buildTable(
      ['Group', 'Score', label],
      (rows || []).map(r => [r.group, String(r.score ?? '—'), r[key] || '']),
    ));
  }

  // 8. Control Map
  blocks.push(heading(2, '8 · Conglomerate Control Map'));
  blocks.push(buildTable(
    ['Group', 'Promoter', 'Succession', 'Board', 'Partners', 'Political'],
    (data.control_map || []).map(r => [
      r.group, String(r.promoter ?? '—'), String(r.succession ?? '—'),
      String(r.board ?? '—'), String(r.partners ?? '—'), String(r.political ?? '—'),
    ]),
  ));

  // 9. Ranking
  blocks.push(heading(2, '9 · Ranking'));
  const tiers = [
    ['tier1', 'Tier 1 — System Dominators'],
    ['tier2', 'Tier 2 — Strategic Challengers'],
    ['tier3', 'Tier 3 — Stable Compounders'],
    ['tier4', 'Tier 4 — Fragile / Declining'],
  ];
  for (const [k, label] of tiers) {
    blocks.push(heading(3, label));
    const items = data.ranking?.[k] || [];
    if (!items.length) blocks.push(paragraph('—', { italic: true, color: 'gray' }));
    for (const r of items) blocks.push(bullet(`${r.group} — ${r.rationale}`));
  }

  // 10. Typology
  blocks.push(heading(2, '10 · Typology'));
  const typology = [
    ['platform_empires',       'Platform Empires'],
    ['institutional_builders', 'Institutional Builders'],
    ['industrial_scalers',     'Industrial Scalers'],
    ['capital_allocators',     'Capital Allocators'],
    ['southern_compounders',   'Southern Compounders'],
    ['fragile_leveraged',      'Fragile / Leveraged'],
  ];
  for (const [k, label] of typology) {
    const groups = data.typology?.[k] || [];
    blocks.push(bullet(`${label}: ${groups.join(' · ') || '—'}`));
  }

  // 11. Red Flags
  blocks.push(heading(2, '11 · Red Flags'));
  if (!data.red_flags?.length) {
    blocks.push(callout('No red flags raised this cycle.', '✅'));
  } else {
    for (const f of data.red_flags) blocks.push(callout(`${f.group} — ${f.flag}`, '🚩'));
  }

  // 12. Emerging Themes
  blocks.push(heading(2, '12 · Emerging Themes'));
  for (const t of (data.emerging_themes || [])) {
    blocks.push(bullet(`${t.title} — ${t.thesis}`));
  }

  // 13. Bottom Line
  blocks.push(heading(2, '13 · Bottom-Line View'));
  for (const b of (data.bottom_line || [])) blocks.push(bullet(b));

  return blocks;
}

async function findExistingPage(parentId, title, key) {
  const body = {
    query: title,
    filter: { property: 'object', value: 'page' },
  };
  const res = await notionFetch('/search', { method: 'POST', body: JSON.stringify(body) }, key);
  return (res.results || []).find(p => {
    const parent = p.parent || {};
    if (parent.page_id?.replace(/-/g, '') !== parentId.replace(/-/g, '')) return false;
    const titleProp = p.properties?.title?.title || p.properties?.Name?.title || [];
    const text = titleProp.map(t => t.plain_text).join('');
    return text.trim() === title.trim();
  });
}

async function archivePage(pageId, key) {
  await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  }, key);
}

async function appendChildren(pageId, blocks, key) {
  const CHUNK = 90;
  for (let i = 0; i < blocks.length; i += CHUNK) {
    await notionFetch(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks.slice(i, i + CHUNK) }),
    }, key);
  }
}

export async function publishNotion({ data, cycleLabel }) {
  const key = process.env.NOTION_API_KEY;
  const parentId = process.env.NOTION_PARENT_PAGE_ID;

  if (!key || !parentId) {
    console.warn('[Publisher/Notion] NOTION_API_KEY or NOTION_PARENT_PAGE_ID not set — skipping.');
    return { skipped: true, reason: 'missing-env' };
  }

  const title = `Conglomerates Tracker — ${cycleLabel}`;

  try {
    const existing = await findExistingPage(parentId, title, key);
    if (existing) {
      console.log(`[Publisher/Notion] Found existing page "${title}" — archiving for fresh write.`);
      await archivePage(existing.id, key);
    }

    const initialBlocks = buildBlocks(data, cycleLabel).slice(0, 90);
    const remainingBlocks = buildBlocks(data, cycleLabel).slice(90);

    const page = await notionFetch('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties: {
          title: { title: [{ type: 'text', text: { content: title } }] },
        },
        children: initialBlocks,
      }),
    }, key);

    if (remainingBlocks.length) {
      await appendChildren(page.id, remainingBlocks, key);
    }

    console.log(`[Publisher/Notion] Published "${title}" → ${page.url}`);
    return { skipped: false, pageId: page.id, url: page.url };
  } catch (err) {
    console.error(`[Publisher/Notion] Failed: ${err.message}`);
    return { skipped: false, error: err.message };
  }
}
