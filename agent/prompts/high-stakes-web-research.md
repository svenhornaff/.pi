---
description: Full multi-provider web research for decisions that matter (vs. the fast SearXNG-first daily default)
argument-hint: "<topic>"
---

Perform high-stakes web research on: $ARGUMENTS

The daily default (`~/.pi/web-search.json` → `searchRouting`) is SearXNG-first,
sequential, cheap — good for quick lookups, but not exhaustive. Use this template
instead when the answer will inform a real decision (architecture choice, security
claim, pricing/cost figure, dependency to adopt, anything going into a report).

Use `web_search` with:
- 2-4 varied queries covering different angles (not near-duplicates): official
  docs, community/issues/real-world experience, current best practices, and any
  competing/contrarian viewpoint
- `provider: ["openai", "exa", "brave", "tavily", "searxng"]` (explicit array —
  overrides the daily-default `searchRouting`, fans out across all 5 in parallel)
- `includeContent: true` so full page content is available for source-checking
- `workflow: "summary-review"`

Then run `source_check` on any specific factual claim that the decision hinges on
(a number, a compatibility claim, a "X is deprecated/recommended" statement) before
treating it as settled — don't rely on the search summary alone for load-bearing facts.

Report findings with inline citations, and flag explicitly if sources disagree.
