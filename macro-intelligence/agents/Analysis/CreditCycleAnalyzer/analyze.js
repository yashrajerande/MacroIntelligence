/**
 * CreditCycleAnalyzer — Pure code. No LLM.
 *
 * Produces the Lender's Lens (S12): where the credit cycle is, whether the
 * system can fund more lending, whether fast growth is healthy, and a
 * Lend / Selective / Caution stance per sector book. Reads S5 credit
 * indicators (MacroDataAnalyst), S11 sectoral growth and asset-quality
 * prints (LeverageAnalyst), and the Minsky sector reads (LeverageAnalyzer).
 *
 * Every number on the panel is a pipeline indicator; every stance is a
 * rule in skills/lending-rules.js. Nothing here is a judgement call.
 */

import {
  SECTOR_BOOK, fundingGauge, qualityGauge, exportNote, sectorStance, cyclePhase,
} from './skills/lending-rules.js';

export class CreditCycleAnalyzer {
  /**
   * @param {Object} allIndicators — flat slug → indicator map (macro + RE + leverage + market)
   * @param {Object|null} leverage — LeverageAnalyzer output `.data` ({ countries, sectors, narrative })
   */
  analyze(allIndicators, leverage) {
    const start = Date.now();
    const ind = allIndicators || {};
    const sectorReads = {};
    for (const s of leverage?.sectors || []) sectorReads[s.slug] = s;

    const funding = fundingGauge(ind);
    const quality = qualityGauge(ind);
    const exports_ = exportNote(ind);
    const phase   = cyclePhase(ind, funding, quality);
    const heatmap = SECTOR_BOOK.map(s => sectorStance(s, ind, sectorReads[s.slug], quality));

    const lend      = heatmap.filter(h => h.stance === 'Lend').map(h => h.name);
    const caution   = heatmap.filter(h => h.stance === 'Caution').map(h => h.name);
    const selective = heatmap.filter(h => h.stance === 'Selective').map(h => h.name);
    const noData    = heatmap.filter(h => h.stance === 'No data').length;

    // Deterministic narrative. Three sentences, every one carrying a number
    // or a named book. "No data" is stated as such, never blurred.
    let narrative = `${phase.label}. ${phase.note} `;
    narrative += `Funding ${funding.label.toLowerCase()}: ${funding.note} `;
    narrative += `Asset quality ${quality.label.toLowerCase()}: ${quality.note}`;
    if (noData > 0) narrative += ` ${noData} of ${heatmap.length} sector books have no growth print yet.`;

    // One decision rule for a lender entering or growing in India today.
    let decisionRule;
    if (caution.length > 0 && lend.length > 0) {
      decisionRule = `Grow ${lend.slice(0, 3).join(', ')}. Stay out of ${caution.join(' and ')} until delinquency turns. Treat ${selective.length > 0 ? selective.slice(0, 2).join(' and ') : 'crowded books'} as name-by-name, not segment bets.`;
    } else if (lend.length > 0) {
      decisionRule = `Grow ${lend.slice(0, 3).join(', ')}. No sector book is flashing caution; size by funding cost, not by credit risk.`;
    } else if (caution.length > 0) {
      decisionRule = `No sector book clears the bar for growth. Hold tenor short and secured; ${caution.join(' and ')} are late-cycle.`;
    } else {
      decisionRule = 'Insufficient data for a stance. Wait for the sectoral credit and FSR prints.';
    }

    const latency = Date.now() - start;
    console.log(`[CreditCycleAnalyzer] Done in ${latency}ms. Phase: ${phase.label}. Lend ${lend.length} / Selective ${selective.length} / Caution ${caution.length} / No data ${noData}.`);

    return {
      data: {
        phase, funding, quality, exports: exports_, heatmap,
        counts: { lend: lend.length, selective: selective.length, caution: caution.length, no_data: noData },
        narrative, decision_rule: decisionRule,
      },
      meta: { agent: 'CreditCycleAnalyzer', model: 'none', latency_ms: latency, tokens: { input: 0, output: 0 } },
    };
  }
}
