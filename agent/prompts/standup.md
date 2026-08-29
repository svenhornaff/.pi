---
description: Generate a standup summary from recent git activity
---

Generate a standup summary for: $ARGUMENTS

## Steps

1. Run `git log --oneline --since="yesterday" --author="$(git config user.name)"` (or use the time range / branch given in `$ARGUMENTS`)
2. Check `git diff --stat HEAD~5..HEAD` for a sense of scope
3. Note any commits that are PRs merged, or branch names that suggest in-progress work

## Output Format

Write a short standup update in three sections:

**Yesterday**
- What was completed (based on commits / merges)

**Today**
- What is planned next (infer from open branches, WIP commits, or last commit message context)

**Blockers**
- Any obvious blockers visible from the repo state (merge conflicts, failing CI refs in commit messages, TODOs introduced)
- If none are evident: "None visible from git history — check manually"

Rules:
- Keep each section to 2–4 bullet points maximum
- Write in first person, present tense ("Implemented X", "Working on Y")
- Be concrete — reference file names, feature names, or module names where possible
- Keep total output under 150 words
