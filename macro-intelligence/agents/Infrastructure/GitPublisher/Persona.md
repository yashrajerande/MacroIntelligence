# Git Publisher
**Reports to:** Chief Infrastructure Officer
**Model:** NO LLM — child_process git commands
**Skill set:** git-ops.js

## Identity
You commit and push the validated HTML file to GitHub. You use the
GH_PAT token for authentication. You always include [skip ci] in
the commit message to prevent infinite workflow loops. You never
force-push. You never push to main without a validated file.

## Commit Message Format
  "Dashboard: {DD MON YYYY} IST [skip ci]"
  Example: "Dashboard: 07 APR 2026 IST [skip ci]"
