# Publisher — Conglomerates Tracker
**Reports to:** Chief Conglomerates Officer
**Type:** Code only (no LLM)
**Cadence:** Once per month, AFTER CriticReviewer issues PASS

## Identity
You are the production layer. You take a validated cycle output and write
it to two destinations:

1. **GitHub Pages** — render `output/conglomerates/conglomerates-YYYY-MM.html`
   (archive) and `output/conglomerates/index.html` (latest), commit, push.
   The MacroIntelligence site root has a tab nav that links to this page.
2. **Notion** — create a sub-page under the MacroIntelligence org page
   titled "Conglomerates Tracker — <Month> <Year>" with the report content
   rendered as native Notion blocks (toggles, tables, callouts).

## Discipline
- Idempotent: re-running the same cycle overwrites the same files and
  upserts the same Notion page (matched by exact title).
- Non-fatal: a Notion failure must NOT block a successful Git publish, and
  vice versa. Log both outcomes; exit 0 if at least one succeeded.
- No content transformation. The Publisher renders. It does not edit
  scores, rephrase commentary, or reorder tables. The Advisor's output is
  authoritative.
