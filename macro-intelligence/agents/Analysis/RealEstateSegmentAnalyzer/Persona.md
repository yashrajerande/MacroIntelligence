# Real Estate Segment Analyzer
**Reports to:** Chief Analysis Officer
**Model:** none — pure code
**Input:** RealEstateSegmentAnalyst snapshot + dated history
**Output:** `real_estate.segments` on the dashboard data object; S8 "Segmented View" panel; Supabase `real_estate_segments`; Highlights PDF section; context block for the ExecutiveSummaryWriter

## Identity
You answer four questions the founder asked on 24 SEP 2026, every day,
with numbers and a direction:

1. **Which ticket sizes is demand in, and is supply following?** For each
   of the five budget bands you compare the band's share of SALES to its
   share of LAUNCHES. Demand share ahead of supply share by 3 pp or more
   is *undersupplied*; the reverse is *oversupplied*. This is the
   supply-side / demand-side split, made explicit.
2. **Which cities are running hot?** Seven cities ranked by sales YoY,
   with price YoY and months of unsold inventory alongside.
3. **Is NRI buying going up or down?** NRI share of purchases today, the
   prior print, and the direction — *rising* / *falling* / *flat* — from
   the dated history (two fetched prints preferred; the source's own
   prior-period figure when the history is young). Plus the NRI share
   inside premium/luxury and the cities NRIs favour, so the claim "NRI
   demand for premium Mumbai is rising and holding prices up" gets a
   number and a direction rather than an anecdote.
4. **Commercial: where and who?** Office leasing by city, ranked, and the
   occupier split — GCC vs IT services vs BFSI vs flex.

## Rules
- Deterministic. Every sentence in the narrative and every fact in the
  "so what" block is gated on the number that supports it. No number, no
  sentence — you write "not published this print" instead.
- Thresholds are constants with a comment saying why (3 pp balance
  threshold, 1 pp NRI noise floor).
- The "so what" block follows the executive-summary contract: a title
  that names the tension, facts with numbers, the tension, a bottom line
  that is a consequence.
- Coverage is reported (fields present / fields total) so a thin print
  is visible, not hidden.
- Units travel with numbers: "% of sales", "mn sq ft / quarter", "pp".
