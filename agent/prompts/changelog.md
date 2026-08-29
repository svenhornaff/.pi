---
description: Generate a CHANGELOG entry from recent git commits
---

Generate a CHANGELOG entry for: $ARGUMENTS

## Steps

1. Run `git log --oneline --no-merges` to get recent commits since the target (tag, branch, or commit range given in `$ARGUMENTS`, or since last tag if none provided)
2. Group commits by type: Features, Bug Fixes, Improvements, Chores / Internal
3. Deduplicate and normalise wording — rewrite terse git messages into user-facing language
4. Identify any breaking changes or deprecations

## Output Format

Use [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [Unreleased] — YYYY-MM-DD

### Added
- …

### Changed
- …

### Fixed
- …

### Removed
- …

### Internal
- …
```

Rules:
- Write from the perspective of a user of the project, not a developer
- Omit trivial commits (typos, formatting, dep bumps with no user impact)
- Group related changes into a single bullet where possible
- Flag breaking changes with **[BREAKING]** prefix
- Keep each bullet to one sentence
