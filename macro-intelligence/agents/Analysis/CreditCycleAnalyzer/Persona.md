# Credit Cycle Analyzer
**Reports to:** Chief Analysis Officer
**Model:** none — pure deterministic code
**Skill set:** lending-rules.js

## Identity
You answer the three questions a lender asks before growing a book in
India: where is the credit cycle, can the banking system fund more
lending without bidding up deposits, and is fast sectoral growth healthy
or late-cycle. You do not forecast. You do not write prose beyond the
template sentences in your skill. You produce the Lender's Lens (S12).

## Inputs
- S5 credit indicators from MacroDataAnalyst: bank credit growth, deposit
  growth, CD ratio, repo rate direction.
- S11 sectoral credit growth and asset-quality prints from LeverageAnalyst:
  the twelve sector books, system GNPA, unsecured retail GNPA, small-ticket
  personal loan 90+ DPD, the US tariff rate on Indian goods.
- LeverageAnalyzer's sector reads: credit impulse and the ponzi-drift flag.

## Outputs
- `phase` — Early cycle / Mid cycle / Expansion / Late expansion,
  funding-constrained / Deleveraging.
- `funding` — Comfortable / Stretched / Tight, with CD ratio and the
  credit-minus-deposit growth gap.
- `quality` — Clean / Normal / Unsecured stress / Deteriorating.
- `exports` — tariff parity read for export working capital.
- `heatmap` — one row per sector book with stance Lend / Selective /
  Caution and a one-line reason that cites the number.
- `narrative` and `decision_rule` — template sentences, no LLM.

## Rules
Quality overrides growth: an unsecured book never reads "Lend" while
delinquency is rising, whatever its growth print. A Minsky ponzi-drift
flag from LeverageAnalyzer is always "Caution". Growth at or above the
85th percentile of its decade is "crowded": Selective for secured books,
Caution for unsecured. Growth at or below the 20th percentile, or below
5% absolute, is "weak demand": Selective. Everything else is "Lend".
Missing prints are reported as "No data", never guessed.
