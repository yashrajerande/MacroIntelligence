/**
 * ConglomeratesTracker — Pre-flight smoke test.
 * Zero API cost. Verifies module wiring, fixture validation, and renderer
 * output before the orchestrator is allowed to spend a dollar.
 *
 * Aligns with Best Practice #8 (Pre-flight at Zero Cost).
 *
 * Run:  node agents/ConglomeratesTracker/test.js
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name} — ${err.message}`);
    failed++;
  }
}

console.log('ConglomeratesTracker pre-flight\n');

// ── Module imports ─────────────────────────────────────────────────
const { UNIVERSE, CORE, BENCH, TIERS, TYPOLOGIES } = await import('./skills/universe.js');
const { validateCycleOutput } = await import('./skills/validate-cycle.js');
const { renderHTML } = await import('./Publisher/render.js');
const { scanBannedNames } = await import('../../src/utils/banned-names.js');

// ── Universe shape ─────────────────────────────────────────────────
console.log('Universe');
test('CORE has 10 groups', () => assert.equal(CORE.length, 10));
test('BENCH has 11 groups', () => assert.equal(BENCH.length, 11));
test('UNIVERSE = CORE + BENCH (21)', () => assert.equal(UNIVERSE.length, 21));
test('TIERS has 4 entries', () => assert.equal(TIERS.length, 4));
test('TYPOLOGIES has 6 buckets', () => assert.equal(TYPOLOGIES.length, 6));

// ── Boundary validator ─────────────────────────────────────────────
console.log('\nBoundary validator');

function fixtureCycle() {
  const dashRow = g => ({
    group: g,
    vision:  { score: 7, delta: 0 }, talent:  { score: 7, delta: 0 },
    exec:    { score: 7, delta: 0 }, trust:   { score: 7, delta: 0 },
    access:  { score: 7, delta: 0 }, edge:    { score: 7, delta: 0 },
    capital: { score: 7, delta: 0 },
  });
  const mapRow = g => ({
    group: g, political: 7, capital_markets: 7, control_stability: 7, global: 7, ai_energy: 7,
  });
  const ctlRow = g => ({
    group: g, promoter: 7, succession: 7, board: 7, partners: 7, political: 7,
  });
  const scored = (g, score) => ({ group: g, score, interpretation: 'fixture', commentary: 'fixture', why: 'fixture' });

  return {
    cycle_label: 'May 2026',
    window_start: '2026-04-01',
    window_end: '2026-05-01',
    moves: [],
    power_dashboard: UNIVERSE.map(dashRow),
    power_map:       UNIVERSE.map(mapRow),
    debt_wall:       UNIVERSE.map(g => scored(g, 5)),
    execution_receipts: UNIVERSE.map(g => scored(g, 5)),
    momentum:        UNIVERSE.map(g => ({ group: g, score: 0, why: 'fixture' })),
    future_dominance:UNIVERSE.map(g => scored(g, 5)),
    control_map:     UNIVERSE.map(ctlRow),
    ranking: {
      tier1: UNIVERSE.slice(0, 5).map(g => ({ group: g, rationale: 'r' })),
      tier2: UNIVERSE.slice(5, 10).map(g => ({ group: g, rationale: 'r' })),
      tier3: UNIVERSE.slice(10, 16).map(g => ({ group: g, rationale: 'r' })),
      tier4: UNIVERSE.slice(16).map(g => ({ group: g, rationale: 'r' })),
    },
    typology: {
      platform_empires:       UNIVERSE.slice(0, 3),
      institutional_builders: UNIVERSE.slice(3, 7),
      industrial_scalers:     UNIVERSE.slice(7, 11),
      capital_allocators:     UNIVERSE.slice(11, 15),
      southern_compounders:   UNIVERSE.slice(15, 18),
      fragile_leveraged:      UNIVERSE.slice(18),
    },
    red_flags: [],
    emerging_themes: [
      { title: 'AI infra', thesis: '...' },
      { title: 'Energy transition', thesis: '...' },
      { title: 'Deconglomeration', thesis: '...' },
    ],
    bottom_line: ['a','b','c','d','e'],
  };
}

test('clean fixture passes validator', () => {
  const v = validateCycleOutput(fixtureCycle());
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test('catches missing universe coverage', () => {
  const f = fixtureCycle();
  f.power_dashboard.pop();
  const v = validateCycleOutput(f);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.includes('power_dashboard')), v.errors.join(';'));
});

test('catches out-of-range score', () => {
  const f = fixtureCycle();
  f.momentum[0].score = 99;
  const v = validateCycleOutput(f);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.includes('momentum')));
});

test('catches duplicate ranking placement', () => {
  const f = fixtureCycle();
  f.ranking.tier2.push({ group: f.ranking.tier1[0].group, rationale: 'r' });
  const v = validateCycleOutput(f);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some(e => e.includes('duplicates')));
});

test('catches bottom_line bullet count violation', () => {
  const f = fixtureCycle();
  f.bottom_line = ['only one'];
  const v = validateCycleOutput(f);
  assert.equal(v.valid, false);
});

// ── Persona-anchor leak scanner ────────────────────────────────────
console.log('\nPersona-anchor leak scanner');
test('clean text has no name hits', () => {
  assert.deepEqual(scanBannedNames('Reliance is over-extended on capex.'), []);
});
test('catches Mishra leak', () => {
  const hits = scanBannedNames('As Neelkanth Mishra notes, the dual economy...');
  assert.ok(hits.includes('Mishra'), JSON.stringify(hits));
  assert.ok(hits.includes('Neelkanth'), JSON.stringify(hits));
});
test('catches Munger leak', () => {
  const hits = scanBannedNames('Applying a Munger inversion here.');
  assert.ok(hits.includes('Munger'), JSON.stringify(hits));
});
test('catches BCG firm leak', () => {
  assert.ok(scanBannedNames('A BCG senior partner would say...').includes('BCG'));
  assert.ok(scanBannedNames('McKinsey-style discipline').includes('McKinsey'));
});
test('does not false-positive on common words', () => {
  // "ft" inside "front", "draft", "soft" etc. — word-boundary check
  assert.deepEqual(scanBannedNames('The draft is soft on the front foot.'), []);
  // Reuters/Bloomberg as research sources are NOT banned
  assert.deepEqual(scanBannedNames('Source: Reuters, Bloomberg, ET.'), []);
});

// ── Renderer ───────────────────────────────────────────────────────
console.log('\nRenderer');
test('renders fixture to HTML (in tmp dir, not production output)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'congs-render-'));
  try {
    const out = renderHTML({
      data: fixtureCycle(),
      cycleLabel: 'May 2026',
      runDate: '2026-05-01',
      isoMonth: '2026-05',
      outDir: tmp,
    });
    assert.ok(existsSync(out.latestPath));
    assert.ok(out.sizeBytes > 5000, `HTML too small: ${out.sizeBytes}`);
    const html = readFileSync(out.latestPath, 'utf-8');
    assert.ok(html.includes('Conglomerates Tracker'));
    assert.ok(html.includes('Strategic Power Dashboard'));
    assert.ok(html.includes('Reliance'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Workflow + tab shell ───────────────────────────────────────────
console.log('\nIntegration files');
test('monthly workflow exists at repo root', () => {
  const p = join(__dirname, '..', '..', '..', '.github', 'workflows', 'conglomerates-monthly.yml');
  assert.ok(existsSync(p), `missing: ${p}`);
});
test('root index.html is a tab shell, not the old redirect', () => {
  const p = join(__dirname, '..', '..', '..', 'index.html');
  const html = readFileSync(p, 'utf-8');
  assert.ok(html.includes('id="tab-cong"'), 'tab shell missing Conglomerates tab');
  assert.ok(html.includes('id="tab-macro"'), 'tab shell missing Daily Macro tab');
});
test('package.json has conglomerates script', () => {
  const p = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(p, 'utf-8'));
  assert.ok(pkg.scripts.conglomerates, 'npm run conglomerates missing');
});

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
