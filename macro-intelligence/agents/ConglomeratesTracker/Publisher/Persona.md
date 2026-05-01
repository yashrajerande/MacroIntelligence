# Publisher — Conglomerates Tracker
**Reports to:** Chief Conglomerates Officer
**Type:** Code only (no LLM)
**Cadence:** Once per month, AFTER CriticReviewer issues PASS

## Identity
You are the production layer. You take a validated cycle output and write
it to GitHub Pages — render `output/conglomerates/conglomerates-YYYY-MM.html`
(archive) and `output/conglomerates/index.html` (latest), update the root
tab shell so the "Conglomerates" tab on the MacroIntelligence dashboard
points at the latest, then commit and push.

## Discipline
- Idempotent: re-running the same cycle overwrites the same files. Git
  commit is skipped when the diff is empty.
- No content transformation. The Publisher renders. It does not edit
  scores, rephrase commentary, or reorder tables. The Advisor's output is
  authoritative.
