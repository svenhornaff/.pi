# Upstream provenance

- **Source:** `@earendil-works/pi-coding-agent` npm package, bundled
  `examples/extensions/subagent/{index.ts,agents.ts}`.
- **Pinned version:** **v0.87.1** (matches the installed `pi --version` and
  `agent/settings.json`'s `lastChangelogVersion` at vendor time,
  2026-09-23). The original `subagent_concept.md` draft assumed v0.85.1;
  corrected during Phase 0 (see `docs/subagent-eval.md` §4, Q4) once the
  actual installed version was checked.
- **No git SHA recorded.** This is vendored from an installed npm package,
  not a git checkout of the pi monorepo -- there is no upstream commit SHA
  available from `node_modules`/the global install to pin against. If pi's
  own source repo becomes accessible in this environment, prefer re-pointing
  this note at the actual commit for the v0.87.1 tag.
- **Files taken verbatim from upstream (structure), then delta-patched
  in-place** (not kept as a separate patch/diff file, so the runtime is one
  readable set of files matching `subagent_concept.md` §3.3's layout):
  - `agents.ts` -- D2 (`extensions`, `timeoutMs` frontmatter), D3 (reject
    agents without a non-empty `tools:` list instead of silently
    proceeding), D8 (confirmed unchanged: `agentScope` default stays
    `"user"`).
  - `index.ts` -- D1 (all argv/env now built via `./launch.ts`'s
    `buildChildArgs`, replacing the upstream inline `args.push(...)`
    sequence; `--no-session` removed entirely), D2 (timeout enforcement:
    SIGTERM then SIGKILL after a grace period), D4 (checks
    `PI_SUBAGENT_DEPTH` before calling `buildChildArgs`, which itself also
    refuses at depth >= 1), D6 (tool `description` replaced with the §6
    delegation policy verbatim), D7 (`child: $x.xx, N/M tok, model` cost
    line appended to every returned result text).
  - Two vendored patterns needed a mechanical (behavior-preserving) rewrite
    to pass this repo's write-time lint (`pi-lens`): a `Record<string, any>`
    tightened to `Record<string, unknown>` in the `DisplayItem` type, and a
    `.map(async () => { while (true) ... })` worker-pool loop rewritten as
    an explicit `for` loop pushing promises (same concurrency-limiting
    behavior, `Promise.all` still awaits all workers). Neither changes
    argv/env construction or any of D1-D8.
- **New, not from upstream:** `launch.ts` (pure `buildChildArgs`, D1/D3-D5/D8,
  zero pi imports, unit-tested by `scripts/test-subagent-launch.ts`).

## Local deltas at a glance (subagent_concept.md §7 Phase 1)

| Delta | What | File |
|---|---|---|
| D1 | `buildChildArgs()` implements §3.2 exactly; guardrail `-e` always present, never `--no-session`, always `--session-dir`+`--name` | `launch.ts` |
| D2 | Frontmatter `extensions:` + `timeoutMs`; timeout enforced (SIGTERM -> SIGKILL) | `agents.ts`, `index.ts` |
| D3 | `tools` required; missing/empty rejects the agent file (discovery) and throws (launch, defense-in-depth) | `agents.ts`, `launch.ts` |
| D4 | Recursion guard: refuse when inherited `PI_SUBAGENT_DEPTH >= 1` | `index.ts`, `launch.ts` |
| D5 | `MAX_CONCURRENCY = 2`, `MAX_PARALLEL_TASKS = 4` | `launch.ts` |
| D6 | Tool description = §6 delegation policy verbatim | `index.ts` |
| D7 | Cost line in every returned result text | `index.ts` |
| D8 | `agentScope` default stays `"user"` (unchanged from upstream) | `index.ts`, `agents.ts` |

## Re-vendor procedure (for the next pi upgrade)

1. Diff the newly-installed
   `.../pi-coding-agent/examples/extensions/subagent/{index,agents}.ts`
   against the version noted above as the last-vendored baseline (keep a
   copy of the exact vendored-at files, e.g. tag them in this repo's own git
   history, to diff against -- there is no upstream git history to diff
   here).
2. Re-apply D1-D8 on top of the new upstream shape; re-run
   `node --experimental-strip-types scripts/test-subagent-launch.ts` and
   `scripts/smoke-test-extensions.sh` (S1-S6) before switching over.
3. Update this file's pinned version and the delta table above if anything
   about the deltas themselves had to change to fit the new upstream shape.
4. Log the re-vendor in `setup-refactor-plan.md`, per this repo's decision-log
   conventions -- "ran X, got Y", not "should still work."
