/**
 * Vintage helpers — shared by the Validator (L2 check) and the data-cache
 * self-heal step, so both agree on what "in the future" means.
 *
 * A data vintage is the period a print refers to ("July 2026", "Q1 FY27",
 * "2026-09-16"). An LLM extractor sometimes returns the NEXT scheduled
 * release date instead (the ECB meeting two days ahead, say). That print
 * cannot be real, so the pipeline substitutes the cached value rather than
 * publishing a number from the future — or failing the run over it.
 */

const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/**
 * @param {string} vintage — free-text vintage as the fetchers deliver it
 * @param {string} runDate — ISO date of the run (YYYY-MM-DD)
 * @returns {boolean}
 */
export function isVintageInFuture(vintage, runDate) {
  if (!vintage || vintage === 'Awaited') return false;
  const lower = String(vintage).toLowerCase().trim();

  // Try ISO date: "2026-04-07"
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return new Date(lower) > new Date(runDate);
  }

  // Try "DD Mon YYYY" or "Mon YYYY"
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.includes(MONTH_NAMES[i])) {
      const yearMatch = lower.match(/\d{4}/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        const month = i;
        const vintageMonth = new Date(year, month, 1); // start of month
        const runMonth = new Date(new Date(runDate).getFullYear(), new Date(runDate).getMonth(), 1);
        return vintageMonth > runMonth; // allow current month
      }
    }
  }

  // Try "Q3 FY26" → FY26 = 2025-26, Q3 = Oct-Dec 2025
  const fyMatch = lower.match(/q(\d)\s*fy(\d{2})/);
  if (fyMatch) {
    const q = parseInt(fyMatch[1]);
    const fy = parseInt(fyMatch[2]) + 2000;
    // FY26 Q1=Apr-Jun 2025, Q2=Jul-Sep 2025, Q3=Oct-Dec 2025, Q4=Jan-Mar 2026
    const yearMap = { 1: fy - 1, 2: fy - 1, 3: fy - 1, 4: fy };
    const monthEnd = { 1: 5, 2: 8, 3: 11, 4: 2 }; // end months (0-indexed)
    const endDate = new Date(yearMap[q], monthEnd[q] + 1, 0);
    return endDate > new Date(runDate);
  }

  return false;
}
