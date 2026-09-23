# Subagent Layer for `svenhornaff/.pi` @ `p-mac` — Concept v1.0

*Status: proposal, Phase 0 partially complete · Date: 2026-09-23 · Scope: `~/.pi` on p-mac (pi v0.87.1 installed — doc originally assumed v0.85.1; superseded by the Phase 0 version decision, see Phase 0 status note) · Owner: Sven*

---

## 0. Executive summary

`p-mac` already has a strong single-agent harness:

- **Guardrails:** `permission-gate.ts`, `protected-paths.ts`
- **Checkpoints:** `git-checkpoint.ts`
- **Context and cache economy:** `pi-condense`, `cache-warm`
- **Feedback and review surfaces:** `pi-lens` (diagnostics), `Plannotator` (human plan/diff gate)
- **Escalation:** `advisor-pi`, which calls GPT-5.6 Sol, billed separately and capped at 5 calls
- **Web:** `pi-web-access` with SearXNG-first routing

What's missing is a way to push *read-heavy* or *independent-judgement* work out of the main context. This concept adds that layer. Three constraints come from this repo's own rules and history:

- **Rule 3 of `AGENTS.md`:** the guardrails are the only isolation layer. That has to stay true inside every child process.
- **Cost incidents:** this repo already had one (€275, `prompt-cache-analysis.md`). Child spend must therefore be visible in `/session-stats` and `session-usage-report.py`.
- **Community consensus as of Sep 2026:** observability beats black boxes, 2–3 narrow read-only agents beat a roster, invocation should be explicit, and writers need isolation or shouldn't be delegated.

**Decision in one line:**

- Vendor pi's own reference `subagent` extension, pinned to v0.85.1.
- Launch every child with `-ne` plus explicitly re-loaded guardrails.
- Persist named child sessions so each child is observable.
- Add six repo-owned, read-only-first agents in phases.
- Gate each phase on measured value.
- Main stays the only writer; `advisor` stays main-only.

| Dimension | Original ChatGPT concept | This concept |
|---|---|---|
| Role set / principles | Good (explore→design→implement→review→verify) | Kept; phased and gated |
| Runtime choice | `npm:<subagent-package>` placeholder | Vendored reference extension, ADR-1 |
| Guardrails in children | Not addressed | Hard invariant, smoke-tested |
| "Read-only" enforcement | Prompt text | Tool allowlists + bounded `git_diff` tool; no `bash` in read-only roles |
| Advisor | Called by architect child (cap resets per child) | Main-only; architect returns an escalation flag |
| Delegation policy location | Root `AGENTS.md` (only loads inside `~/.pi`) | `subagent` tool description (absent in children) |
| Cost visibility | Not addressed | `session-stats` + usage report include children |
| Repo change discipline | Not addressed | Smoke tests, surface diff, decision log per phase |
| Measurement | None | Baseline + bake-off + keep/kill criteria |

---

## 1. Current state (verified against the repo, commit `3f49563`)

| Area | Fact | Relevance |
|---|---|---|
| Default model | `openrouter/anthropic/claude-sonnet-5`, thinking `medium` | Main = implementer; reviewer should be a different model family |
| Enabled models | sonnet-5, glm-5.3, kimi-k3, deepseek-v4-pro, gpt-5.6-{luna,terra,sol}, ollama qwen3:4b, llmhub/claude-sonnet-4.6 | Pool for agent model assignment |
| Packages | pi-web-access, pi-condense@2.9.1, cache-warm, pi-lens, rpiv-ask-user-question, statusline-pi, Plannotator, advisor-pi | All load in any `pi -p` child unless `-ne` |
| `permission-gate.ts` | Blocks outright when `!ctx.hasUI` | Children are headless → fail-closed (good) |
| `protected-paths.ts` | Blocks writes to secrets/config, including bash redirection | Must load in children |
| `advisor-pi` 1.1.0 | Tool `advisor`; `useCount` restored from session branch on `session_start` | A fresh child session starts at 0, so each child gets a new 5-call cap |
| `session-stats.ts` | Sums `usage` of assistant + `toolResult` messages | The reference subagent runtime reports child usage in `details`, not in `usage`, so child spend is invisible today |
| `session-usage-report.py` | `rglob("*.jsonl")` under `~/.pi/agent/sessions` | Child sessions persisted under `sessions/subagents/` are picked up automatically |
| Root `AGENTS.md` | Project context for maintaining `~/.pi` | Only loads when pi's cwd is inside `~/.pi`; not global |
| `agent/AGENTS.md` | Does not exist | Global instructions file is unused |
| Smoke test | `scripts/smoke-test-extensions.sh` with `check <label> <regex> <cmd>` | Extend for children |
| Change rules | README tables, `setup-refactor-plan.md` log, surface diff, JSON validation, `.bak` before scripted edits | Apply to every phase |
| pi version | `lastChangelogVersion: 0.85.1` | `nicobailon/pi-subagents` requires `pi-ai >= 0.86.1` |

---

## 2. Community research (Sep 2026) — what others do, and what fits `p-mac`

### 2.1 Pi core team stance

- **Pi deliberately ships no built-in subagents.**
  - Mario Zechner's objection is that subagents become a black box inside a black box: you can't see what they read or missed. [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
  - His suggested alternative is to start another pi instance via bash, optionally in tmux, so the child's whole interaction stays visible. [yage.ai summary](https://yage.ai/share/pi-coding-agent-locked-out-en-20260518.html)
- **Armin Ronacher (Earendil, co-maintainer) reviews in a branch, not in a subagent.**
  - He branches into a fresh context for code review or tool repair, brings the findings back, and flags things like new dependencies before a human looks. [RuntimeWire, Sep 12 2026](https://runtimewire.com/article/david-ondrej-armin-ronacher-pi-agent-workflow)
  - He has seen models behave worse when working through subagents, apparently "where nobody is looking", and that sloppiness leaks into committed code (tests especially). [lucumr, Sep 2026](https://lucumr.pocoo.org/2026/9/7/astra-why/)
  - He sees orchestration and subagents mattering more over time, but wants to avoid uncontrolled swarms making changes nobody can follow. [lucumr "The Coming Loop"](https://lucumr.pocoo.org/2026/6/23/the-coming-loop/)
- **Security baseline:** pi has no permission system and runs with the user's permissions. Isolation needs a container, sandbox, or Gondolin micro-VM. [pi README](https://github.com/earendil-works/pi)

### 2.2 Ecosystem packages

| Project | What it does | Fit for p-mac |
|---|---|---|
| **pi reference `examples/extensions/subagent`** | ~1.2k LOC; spawns `pi --mode json -p`; single/parallel (max 8, 4 concurrent)/chain; agents in `~/.pi/agent/agents/*.md`; project agents opt-in | **Chosen base.** Same provenance as `permission-gate.ts` and `git-checkpoint.ts` ("Reference: examples/extensions/…") |
| **nicobailon/pi-subagents** (most-starred, ~1.2k; v0.71.0 released 2026-09-23) | Rich: builtin scout/researcher/worker/reviewer/oracle, fresh-reviewer loops, worktrees, async runs, fleet view, `/subagent-cost`, depth guard, lazy tool loading | **Rejected for now.** Needs pi ≥ 0.86.1; ships an `oracle` aliased `advisor` (clashes with advisor-pi); foreground children never load ambient extensions, so guardrails are off unless declared per agent; very high churn |
| **@minhduydev/pi-subagents** | Runtime-only, ships **no** agent profiles, consumer owns `~/.pi/agent/agents/*.md`; worktree isolation, review gates, tmux/Herdr backends | Philosophically closest ("runtime thin, personas repo-owned"); young and Herdr-centric. **Watch-list** |
| **Jeecabs/gang** | Subagents as visible tmux panes with a message bus, durable log, mission control | Validates the observability principle; too heavy for now |
| **shalomb pi-sub-agent (skill)** | Runs pi in tmux with lean flags (`--no-extensions`, `--no-skills`…), streams JSONL | Lean-child pattern is right, **but `--no-extensions` alone drops the guardrails**; p-mac must re-add them with `-e` |
| **pi-intercom / pi-messenger** | 1:1 session messaging / filesystem swarm coordination | Out of scope; revisit only if children need to ask the parent questions |
| **nicobailon/pi-review-loop** | Repeats the review prompt until nothing is found; fresh-context option; max iterations | Adopt the *idea* (capped loop) inside `/ship-check`, not the package |
| **pi-boomerang** | Collapses task context automatically | Overlaps pi-condense; skip |

### 2.3 Cross-tool practitioner consensus

- **Start small and read-heavy.** What works: 2–3 narrowly scoped agents, read-heavy work, tight tool lists, small structured outputs, explicit invocation. What fails: a roster of ten personas with auto-routing, which burns budget. [Leland, Jul 2026](https://www.joinleland.com/library/a/claude-subagents)
- **Tokens multiply.** Anthropic's figures are roughly 4–7× tokens for multi-agent workflows and about 15× for agent teams. [ksred](https://www.ksred.com/claude-code-agents-and-subagents-what-they-actually-unlock/)
- **Delegation isolates context, not authority.** A child knows less but can still do everything unless you narrow its tools. The same write-up reports Claude Code's defaults: 3 levels of depth, 20 concurrent children, no spend cap. [dev.to/waxell](https://dev.to/waxell/subagent-permissions-are-inherited-by-default-and-the-caps-live-inside-your-code-i)
- **Recommended team shape:** one accountable orchestrator, bounded workers, independent verification, narrow execution permissions. Evaluate on ≥20 representative tasks before routing across models. [Wavect, Sep 2026](https://wavect.io/blog/multi-model-ai-coding-agent-stack-2026/)
- **Reviewer diff access.** pi-subagents gave its reviewer a bounded, read-only diff tool instead of shell or general git access (PR #2333). [PR](https://github.com/nicobailon/pi-subagents/pull/2333)
- **Delegation must be authorized.** pi-subagents' own docs say complexity alone does not authorize delegation; the full tool only loads once the request or instructions permit it. [README](https://github.com/nicobailon/pi-subagents)
- **Recommended implementation loop:** clarify → scout → worker → fresh reviewers → worker, with reviewers on distinct angles (correctness / tests / complexity). [workflows.md](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md)

### 2.4 What we adopt / reject

| Adopt | Why |
|---|---|
| Persisted, named child sessions (not `--no-session`) | Mario/Armin observability principle; lets you `/resume` a child and see what it read |
| Read-only roles only; main is the sole writer | Armin's "nobody is looking" observation plus parallel-write risk |
| Bounded `git_diff` tool for reviewer/security, no `bash` | pi-subagents #2333 pattern; makes "read-only" structural |
| Explicit invocation via prompt templates / user request | Leland + pi-subagents authorization rule |
| Fresh reviewers with distinct angles, capped loop | pi-subagents / pi-review-loop |
| Model tiering + cross-family reviewer | Consensus; reduces correlated blind spots |
| Baseline + bake-off before expanding | Wavect / Leland |
| Branch-based review (`/tree` / `/fork`) as zero-code baseline | Armin's actual workflow; Phase 0 control group |

| Reject (for now) | Why | Re-entry trigger |
|---|---|---|
| Writer / worker / developer subagents | Quality + write-conflict risk; main already implements | Repeated need for parallel independent implementation **and** worktree isolation in place |
| Async/background children | Adds runner lifecycle and cost opacity | Tasks > 10 min where blocking the main session hurts |
| Agent teams / swarms / intercom | Theatre at this scale; 15× token profile | A concrete coordination problem that one orchestrator can't solve |
| Second oracle agent | `advisor-pi` exists | Never, unless advisor-pi is removed |
| Project-local agents (`.pi/agents`) | Repo-controlled prompts = injection surface | Only for trusted repos, explicit `agentScope: "both"` |

---

## 3. Architecture

### 3.1 Target shape

```text
                           MAIN PI  (sonnet-5, medium) — sole writer
                 owns: implementation, advisor(), Plannotator, final decision
                                      │
                 subagent tool (vendored, agent/extensions/subagent/)
      ┌──────────────┬───────────────┼───────────────┬──────────────┐
      ▼              ▼               ▼               ▼              ▼
  explorer       architect        reviewer        security       verifier      researcher
  read-only      read-only        read-only       read-only      bash (gated)  read-only + web
      │              │  escalate:yes                                   │
      │              └────────────► main ──► advisor() (max 5, main only)
      │
  every child = separate `pi` process:
    -ne  + -e permission-gate.ts + -e protected-paths.ts [+ role extras]
    --tools <allowlist>  --model <id:thinking>
    --session-dir ~/.pi/agent/sessions/subagents  --name "<role>: <task>"
```

### 3.2 Child launch contract (the core invariant)

```text
pi --mode json -p
   -ne                                          # no ambient extensions/packages
   -e  ~/.pi/agent/extensions/permission-gate.ts # ALWAYS
   -e  ~/.pi/agent/extensions/protected-paths.ts # ALWAYS
   [-e <role extras from frontmatter `extensions:`>]
   --tools <frontmatter tools, explicit, never empty-means-default>
   --model <frontmatter model incl. :thinking>
   --session-dir ~/.pi/agent/sessions/subagents
   --name "<role>: <task, 60 chars>"
   --append-system-prompt <tmp role prompt, mode 0600>
   "Task: …"
env: PI_SUBAGENT_DEPTH=<parent+1>
```

What each part guarantees:

- **`-ne`** means the child loads none of cache-warm, pi-condense, statusline, obsidian-sync, welcome-dashboard, Plannotator, advisor-pi, pi-lens, or the subagent tool itself. That gives no recursion, no advisor cap reset, and no side effects.
- **The two explicit `-e` flags** put the guardrails back. Because children run headless, `permission-gate.ts` fails closed.
- **Project `AGENTS.md` still loads** (no `-nc`), so reviewer and verifier see the project's own conventions and test commands.
- **The delegation policy lives in the `subagent` tool description.** Children never load that tool, so they never see the policy.

### 3.3 Where things live

```text
agent/
├── agents/                         # NEW — repo-owned personas (user scope)
│   ├── explorer.md
│   ├── reviewer.md
│   ├── architect.md
│   ├── verifier.md
│   ├── security.md
│   └── researcher.md
├── extensions/
│   ├── subagent/                   # NEW — vendored runtime (auto-loaded by MAIN only)
│   │   ├── index.ts                # from pi v0.85.1 examples + p-mac changes
│   │   ├── agents.ts               # frontmatter: + extensions, timeoutMs
│   │   ├── launch.ts               # NEW — pure buildChildArgs(), no pi imports (testable)
│   │   └── UPSTREAM.md             # pinned tag, upstream SHA, list of local deltas
│   ├── permission-gate.ts          # unchanged (+ smoke cases)
│   ├── protected-paths.ts          # unchanged (+ smoke cases)
│   └── session-stats.ts            # CHANGED — counts child usage
├── subagent-child/                 # NEW — child-only extensions, NOT auto-discovered
│   └── git-diff-tool.ts            # bounded read-only diff tool
├── prompts/
│   ├── review-fresh.md             # Phase 0 — branch-based review (no runtime)
│   ├── design.md                   # Phase 3 — explorer → architect → Plannotator
│   └── ship-check.md               # Phase 4 — reviewers ∥ → verifier
scripts/
├── smoke-test-extensions.sh        # CHANGED — child invariants
├── test-subagent-launch.ts         # NEW — deterministic, no model calls
└── lint-agents.py                  # NEW — frontmatter policy lint
docs/ (or root)
└── subagent-eval.md                # NEW — baseline + bake-off log
```

Child-only tools must **not** live in `agent/extensions/`. Pi auto-discovers `extensions/*.ts` and `extensions/*/index.ts` into the main session.

---

## 4. Architecture decision records

**ADR-1 — Runtime: vendor pi's reference extension.**

- **Options considered:**
  - vendored reference;
  - `nicobailon/pi-subagents`;
  - `@minhduydev/pi-subagents`;
  - tmux skill.
- **Decision:** vendor the reference at the tag matching installed pi (v0.85.1).
- **Rationale:**
  - Matches repo convention and dependency policy (no new deps).
  - Spawns real processes, so the guardrail contract is controllable.
  - Small enough to audit.
  - No forced pi upgrade.
- **Cost:** we own ~1.2k LOC and must diff upstream on every pi upgrade (`UPSTREAM.md`).
- **Revisit when** async runs, worktrees, or a fleet UI are needed, or when pi-subagents offers a guardrail-inheritance guarantee that can be smoke-tested.

**ADR-2 — Guardrails in every child.** `permission-gate.ts` and `protected-paths.ts` are appended by `buildChildArgs()` unconditionally. An agent's frontmatter cannot remove them. Enforced by a deterministic test and a live smoke case.

**ADR-3 — Main is the only writer.**

- No agent has `edit` or `write`.
- Only `verifier` has `bash`, and it runs strictly after main stops editing, never in parallel with it.

**ADR-4 — `advisor` is main-only.**

- No child can load advisor-pi (`-ne`).
- The architect returns `escalate: yes|no` plus a one-paragraph question.
- Main decides whether to call `advisor`, which keeps the 5-call cap meaningful.

**ADR-5 — Observable children.**

- Children persist sessions under `~/.pi/agent/sessions/subagents/` with `--name "<role>: <task>"`.
- This is already covered by `.gitignore` (`agent/sessions/`), `archive-old-sessions.sh`, and `session-usage-report.py` (rglob).

**ADR-6 — Explicit invocation.**

- Delegation happens when Sven asks for it, or through `/design`, `/ship-check` or `/review-fresh`.
- The tool description tells main not to self-delegate trivial work and to *propose* delegation rather than run it unprompted.
- Revisit auto-invocation only after the Phase 6 data.

**ADR-7 — Policy in the tool description, not in context files.** The policy is scoped to where the tool exists, so it never leaks into children and needs no `agent/AGENTS.md`.

**ADR-8 — Bounded `git_diff` instead of `bash` for review roles.**

- Fixed argv via `pi.exec`, no shell.
- cwd-bound.
- Output capped.
- Rejects ranges containing anything other than `[A-Za-z0-9._/~^-]` and `..`.

**ADR-9 — Cross-family reviewer.** Reviewer and security must not use the same model family as the main session (Anthropic). Enforced by `lint-agents.py`.

**ADR-10 — Model allowlist for agents.**

- Agent models must be in `enabledModels`.
- `llmhub/*` and `ollama/*` are rejected by lint unless a line in `setup-refactor-plan.md` explicitly justifies them.
- Reasons: llmhub is the provider behind the repo's caching incident; the local qwen was already documented as flaky under load.

---

## 5. Agent specifications

Models are **starting points**; Phase 6 decides. `:thinking` uses pi's model-suffix syntax.

| Agent | Phase | Tools | Extra `-e` | Model (start) | Timeout | Output contract |
|---|---|---|---|---|---|---|
| explorer | 2 | read, grep, find, ls | — | `openrouter/deepseek/deepseek-v4-pro:low` (alt `z-ai/glm-5.3:low`) | 5 min | Findings with `path:line`, relevant files, call flow, uncertainties, "start here" |
| reviewer | 2 | read, grep, find, ls, git_diff | git-diff-tool.ts | `openai-codex/gpt-5.6-terra:high` | 8 min | BLOCKER/MAJOR/MINOR/NIT with `path:line`, consequence, fix; "no material issues" allowed |
| architect | 3 | read, grep, find, ls | — | `openrouter/anthropic/claude-sonnet-5:high` | 10 min | Goal, constraints, design, affected files, interfaces, risks, sequence, acceptance criteria, `escalate` |
| verifier | 4 | read, grep, find, ls, bash | — (permission-gate already) | `openrouter/moonshotai/kimi-k3:medium` | 15 min | PASS / PASS WITH WARNINGS / FAIL; per criterion: command run + excerpt |
| security | 5 | read, grep, find, ls, git_diff | git-diff-tool.ts | `openai-codex/gpt-5.6-terra:high` | 8 min | Findings by exploitability; trust boundary named; "none found" allowed |
| researcher | 5 | read, web_search, fetch_content, get_search_content, source_check | pi-web-access entry | `openrouter/z-ai/glm-5.3:low` | 8 min | Answer + sources + version/date; flags when `/high-stakes-web-research` is warranted |

Never in any child: `edit`, `write`, `advisor`, `subagent`, and `bash` except for the verifier.

Full prompt drafts are in **Appendix A**.

---

## 6. Delegation policy (embedded in the `subagent` tool description)

```text
Delegate only when it keeps noisy reading or independent judgement out of this
session. Do not delegate trivial work (< ~5 files to read, single-line fixes).
Prefer proposing delegation to the user over running it unprompted, unless the
user asked for it or a prompt template (/design, /ship-check) invokes it.

Roles: explorer (repo discovery), architect (design), reviewer (diff review),
security (trust-boundary review), verifier (acceptance proof), researcher
(external facts). All are read-only except verifier (bash, runs tests).

You remain the only writer. Never run verifier while you still intend to edit.
Parallel is allowed only for read-only roles (reviewer ∥ security, explorer ∥ researcher).
Treat child output as claims: spot-check at least one cited path:line before acting.
If architect returns escalate: yes, decide yourself whether to call advisor.
Report the child cost line to the user after every delegation.
```

---

## 7. Phase plan

Each phase ships as its own commit series with a `setup-refactor-plan.md` entry ("found / done / verified by running X, got Y"). A phase **does not start** until the previous phase's *Done When* is met.

### Phase 0 — Baseline, prerequisites, zero-code control

**Goal:** know what "better" means before building anything, and resolve the open technical questions.

**Deliverables**

- `docs/subagent-eval.md` with:
  - a benchmark set of **10 tasks** drawn from trusted repos (`bulliexplorer`, `doc-manager`, `idp-docs`) plus this repo: 3 exploration, 3 feature, 2 bugfix, 2 review-only;
  - for each task, baseline metrics from a *single-agent* run: peak context tokens, total cost, wall time, defects found by a later human review.
- `agent/prompts/review-fresh.md`, a branch-based review template (Armin's pattern: fork or branch to a fresh context, review, summarise back). This is the **control group** for the reviewer agent.
- Verification notes for the open questions:
  - **Q1:** does `-ne` also drop `settings.json` `packages`? Test: `pi -p -ne --model <cheap> "list your tools"` and look for `advisor` / `web_search` in the JSON events.
  - **Q2:** does `-e <abs path>` load under `-ne`? The docs say explicit `-e` still loads; confirm.
  - **Q3:** does `typebox` resolve for a vendored extension without adding it to `agent/extensions/package.json`?
  - **Q4:** does the reference `subagent` example exist unchanged at tag `v0.85.1`? `git diff v0.85.1..main -- packages/coding-agent/examples/extensions/subagent`.
  - **Q5:** billing model of `openai-codex/*` (subscription rate limits vs per-token) and the relative tiers of luna/terra/sol.
  - **Q6:** does `--session-dir` + `--name` work together with `-p --mode json`, and does the session file land where expected?

**Tests**

- Run `review-fresh` on the 2 review-only tasks and record findings plus precision.

**Done When**

- [x] 10 benchmark tasks defined with acceptance criteria, stored in `docs/subagent-eval.md`
- [ ] Baseline metrics recorded for all 10 tasks (single-agent) — **leftover, see below**
- [x] Q1–Q6 answered with command output pasted into the decision log (Q4 superseded by the v0.87.1 vendoring decision, recorded as such; Q7/Q8 correctly carried forward per their own nature — Q7 is a Phase 1 implementation question, Q8 depends on the still-open `/review-fresh` leftover)
- [ ] `/review-fresh` exists and has been used ≥ 2×, with a precision number recorded — **template exists (`agent/prompts/review-fresh.md`); 0 of the required ≥ 2 uses done — leftover, see below**
- [ ] Go/no-go note written. If `/review-fresh` already delivers ≥ 80% of the expected reviewer value, **Phase 2's reviewer is dropped** and only explorer proceeds — **blocked on the two leftovers above, not written**

**Rollback:** none needed (docs and a prompt template only).

**Effort:** S (½–1 day, mostly running tasks)

**Status (2026-09-23): partially done.** Docs/template scaffolding and all six
technical probes were completed and verified with real command output — see
`docs/subagent-eval.md` (full detail) and the `setup-refactor-plan.md`
"2026-09-23: subagent layer, Phase 0" entry (summary + verification commands).
The two data-collection items below were **deliberately not run** unattended
in that session (each is real, multi-hour work against the trusted repos) and
remain open before the phase gate is genuinely met.

**Leftover (Phase 0, not yet done):**

- [ ] Run all 10 benchmark tasks single-agent (current setup, no subagent
      runtime); record peak context tokens, total cost, wall time, and
      later-review defect count for each in `docs/subagent-eval.md` §2.
- [ ] Run `/review-fresh` on the 2 review-only tasks (ideally +1–2 more) and
      label findings true/false to get a precision number, in
      `docs/subagent-eval.md` §3.
- [ ] Write the go/no-go note once the above exists; if `/review-fresh`
      already delivers ≥ 80% of expected reviewer value, drop Phase 2's
      reviewer and update that phase's entry criteria here accordingly.
- [ ] Q7 (`AgentToolResult` carrying `usage` directly) stays open — resolve it
      during Phase 1 implementation, not before.

Phase 1 must not start on the claim that Phase 0 is done while these remain
unchecked; either complete them for real, or get an explicit, logged decision
to proceed with the gate knowingly unmet.

---

### Phase 1 — Runtime foundation (no agents yet)

**Goal:** a subagent runtime whose safety and cost properties are proven before any persona exists.

**Deliverables**

- `agent/extensions/subagent/` vendored from `v0.85.1`, with `UPSTREAM.md` recording tag, SHA and deltas.
- **Local deltas:**
  - **D1** `launch.ts`: a pure `buildChildArgs(agent, task, ctx)` that implements §3.2 exactly. Guardrail `-e` flags are appended unconditionally, never with `--no-session`, and always with `--session-dir` + `--name`.
  - **D2** Frontmatter extensions: `extensions:` (extra `-e` paths, resolved relative to `~/.pi/agent`), `timeoutMs` (kill child after the deadline, report a timeout).
  - **D3** `tools` required. An agent without an explicit `tools` list is **rejected**, never defaulted.
  - **D4** Recursion guard: refuse to spawn if `PI_SUBAGENT_DEPTH >= 1`. Belt-and-braces; `-ne` already prevents it.
  - **D5** `MAX_CONCURRENCY = 2`, `MAX_PARALLEL_TASKS = 4`.
  - **D6** Tool description replaced with the §6 policy.
  - **D7** Tool result includes a cost line (`child: $x.xx, tokens in/out, model`) in the text returned to main.
  - **D8** `agentScope` default stays `"user"`; project agents stay opt-in.
- `session-stats.ts` counts `details.results[].usage` for `toolName === "subagent"`, shown as a separate "subagents" row.
- `scripts/test-subagent-launch.ts`: deterministic tests of `buildChildArgs`, run with `node --experimental-strip-types`.
- `scripts/lint-agents.py`: frontmatter policy lint (see §8.2).
- A temporary test-only agent, `agent/agents/_probe.md` (tools: read, bash; cheap model), used only by the smoke test and deleted at the end of Phase 2.

**Tests** — §8.1 T1–T6, §8.3 S1–S6.

**Done When**

- [x] `test-subagent-launch.ts` green; each invariant covered: guardrails present, `-ne` present, no `--no-session`, `--tools` present and non-empty, `--session-dir` present, depth env set (22/22, incl. the T1–T6 groups)
- [x] Smoke S1–S6 green on p-mac — **S1–S4 scripted and green (14/14 total); S5–S6 verified live with real transcripts but not yet scripted, see leftover below**
- [x] `_probe` child's `git push` is blocked (S1) and its session file exists under `sessions/subagents/` (S4)
- [x] `/session-stats` shows a non-zero "subagents" row after a probe run, equal (±1%) to the child session's own total (S5) — verified via a real `--session`-resume transcript (`(subagents)/mixed` row, turns=1, distinct from and not inflating the main row); not yet a scripted smoke case
- [x] `session-usage-report.py` lists the child session; the parent total **excludes** it, so nothing is double-counted (S6) — verified by reading the script's own source (it only sums `role=="assistant"` per session file and never reads `toolResult`/`details`, so this holds by construction, no code change needed)
- [x] README: new "Subagents" section + extension table row; AGENTS.md "Source layout" entry and new Rule 5 ("child launch args changes require a smoke case")
- [x] Decision-log entry with the surface diff: new tool `subagent`, new dir `agent/agents/`, new scripts

**Status (2026-09-23): done, with one honest gap.** All deliverables built
and verified with real command output (not simulated) — see the
`setup-refactor-plan.md` "2026-09-23: subagent layer, Phase 1" entry for
full verification transcripts. The user explicitly directed starting Phase
1 before Phase 0's two data-collection leftovers (10-task baseline,
`/review-fresh` x2) were finished — logged as a deliberate decision, not a
silent skip; those Phase 0 items remain open.

**Leftover (Phase 1, not yet done):**

- [ ] Script S5 (`/session-stats` non-zero "subagents" row after a probe
      run) and S6 (`session-usage-report.py` correct child/parent
      accounting) into `scripts/smoke-test-extensions.sh` itself. Both are
      verified live with a real, reproducible transcript in
      `setup-refactor-plan.md`, but the `--session`-resume dance needed to
      automate S5 is more involved than S1–S4 and was deliberately
      deferred rather than rushed into a flaky script.
- [ ] `scripts/fixtures/subagent-repo/` (seeded-bug fixture for later
      phases' S11/S12/S14) — not needed until Phase 4/5, not built yet.
- [ ] The still-open Phase 0 leftovers (10-task baseline, `/review-fresh`
      x2, go/no-go note) — unchanged from the Phase 0 status note above.

**Rollback:** `git mv agent/extensions/subagent agent/extensions/subagent.disabled` (same pattern as `status-footer.ts.disabled-…`) and revert `session-stats.ts`.

**Effort:** M (1–2 days)

---

### Phase 2 — First read-only specialists: explorer (+ reviewer if Phase 0 says go)

**Goal:** prove context savings (explorer) and independent review value (reviewer) on real tasks.

**Deliverables**

- `agent/agents/explorer.md`, `agent/agents/reviewer.md` (Appendix A).
- `agent/subagent-child/git-diff-tool.ts`:
  - **modes:** `working`, `staged`, `range`, `stat`, `log -n ≤ 20`;
  - **scope:** optional `paths` inside cwd only;
  - **limits:** output capped at 60 KB with a truncation marker;
  - **execution:** fixed argv via `pi.exec("git", …)`, no shell.
- `_probe.md` removed.

**Tests** — §8.1 T7–T8, §8.3 S7–S9, §8.4 eval on the 3 exploration and 2 review tasks.

**Done When**

- [ ] S7: explorer child cannot write (asked to create `/tmp/pmac-probe.txt`, the file is absent; its JSON events show no `write`/`edit`/`bash` tool)
- [ ] S8: reviewer's `git_diff` returns a diff for a staged change and rejects `range: "HEAD; rm -rf ~"`
- [ ] S9: reviewer child has no `bash` tool
- [ ] **Explorer value:** on the 3 exploration tasks, main-session peak context drops ≥ 30% vs baseline, total cost (parent + child) ≤ 1.3× baseline, and no task needs main to re-read more than 3 files the explorer already summarised
- [ ] **Explorer accuracy:** ≥ 90% of cited `path:line` references spot-check correct (sample 10)
- [ ] **Reviewer value** (if built): precision ≥ 60% (true findings / all findings) and at least one true MAJOR+ finding that `/review-fresh` missed across the 2 review tasks and 3 feature tasks; otherwise keep `/review-fresh` and delete reviewer
- [ ] Decision-log entry per agent: keep / tune / remove

**Rollback:** delete the agent file(s). The runtime stays inert without agents.

**Effort:** M

---

### Phase 3 — Design gate: architect + Plannotator + advisor escalation

**Goal:** better plans for non-trivial changes without spending advisor calls by default.

**Deliverables**

- `agent/agents/architect.md` (Appendix A).
- `agent/prompts/design.md`: explorer → architect in a chain; main posts the plan to Plannotator; nothing is implemented until Sven approves.
- **Escalation protocol:** if the architect says `escalate: yes`, main presents the question and asks before calling `advisor`.

**Tests** — §8.3 S10, §8.4 eval on the 3 feature tasks.

**Done When**

- [ ] S10: architect child has no `advisor` tool and cannot write
- [ ] `/design` produces a plan with every section of the output contract on all 3 feature tasks
- [ ] Plannotator receives the plan in every run; zero implementations started before approval
- [ ] Advisor calls per feature task ≤ 1 on average; each call traceable to an `escalate: yes`
- [ ] Human rating: plan quality ≥ baseline (single-agent plan) on ≥ 2 of 3 tasks; total cost ≤ 1.5× baseline
- [ ] README + decision log updated

**Rollback:** delete `architect.md` and `design.md`.

**Effort:** S–M

---

### Phase 4 — Verification: verifier + `/ship-check`

**Goal:** independent proof that acceptance criteria are met before "done".

**Deliverables**

- `agent/agents/verifier.md` (Appendix A).
- `agent/prompts/ship-check.md`:
  - main declares "editing finished";
  - `reviewer` (angles: correctness, tests) and, if applicable, `security` run in parallel;
  - main synthesises and fixes;
  - at most **2** review iterations;
  - then `verifier` runs once and returns PASS / PASS WITH WARNINGS / FAIL.

**Tests** — §8.3 S11–S13, §8.4 eval on the 3 feature and 2 bugfix tasks.

**Done When**

- [ ] S11: verifier runs the project test command and quotes real output; a deliberately broken test yields FAIL
- [ ] S12: verifier's `npm i -g x` / `git push` attempts are blocked (fail-closed) and reported, not retried in a loop
- [ ] S13: `/ship-check` refuses to start verifier while `git status` shows edits newer than the declared "editing finished" timestamp
- [ ] Zero false PASS on the 5 eval tasks (each seeded with one known defect)
- [ ] Review loop never exceeds 2 iterations; total `/ship-check` cost ≤ 0.5× the implementation cost of the task
- [ ] README + decision log updated

**Rollback:** delete `verifier.md` and `ship-check.md`.

**Effort:** M

---

### Phase 5 — Optional specialists: security, researcher

**Goal:** add only where Phase 2–4 data shows a gap.

**Entry criteria**

- **security:** ≥ 2 eval or real tasks touching auth, secrets, input handling, shell, network or dependencies where reviewer missed or under-rated a real issue.
- **researcher:** ≥ 2 cases where main's web lookups bloated context by > 20k tokens, or relied on a stale version fact.

**Deliverables**

- `security.md` and `researcher.md` (Appendix A).
- The researcher loads pi-web-access via `extensions:` and uses the **default** `searchRouting`. It recommends `/high-stakes-web-research` rather than fanning out itself.

**Tests** — §8.3 S14–S15.

**Done When**

- [ ] S14: security child has no `bash` and no write; runs on a seeded injection bug and finds it
- [ ] S15: researcher child's tool list contains only the allowlisted web tools plus `read`; its queries hit SearXNG first (visible in session JSON)
- [ ] Each agent meets precision ≥ 60% on its trigger cases, otherwise removed
- [ ] README + decision log updated

**Effort:** S each

---

### Phase 6 — Bake-off, tuning, keep/kill

**Goal:** fix models and prompts by evidence, and decide the steady state.

**Activities**

- Run all 10 benchmark tasks with the final setup.
- **Model A/B** per agent: 2 candidates × 3 tasks each, the same commit and prompt. Pick the cheapest that meets the quality gate.
- **Prompt tuning:** at most 2 revisions per agent, each logged.
- **Auto-invocation experiment (optional):** allow main to run explorer without asking for 1 week; compare cost and satisfaction.

**Done When**

- [ ] Final table in `docs/subagent-eval.md`: per agent, model, precision, cost per use, uses per week, keep/kill decision
- [ ] Every kept agent passed its gate. Every removed agent is deleted and its removal logged as a removal (per AGENTS.md)
- [ ] Aggregate: across the 10 tasks, total cost ≤ 1.4× baseline **and** human-found post-merge defects ≤ baseline **and** main peak context ≤ 0.8× baseline. If not met, fall back to the minimal set (explorer + `/review-fresh`)
- [ ] `UPSTREAM.md` includes the procedure for re-vendoring on pi upgrade

**Effort:** M (spread over 2–3 weeks of normal use)

---

### Phase 7 — Deferred (explicitly not planned)

| Capability | Re-entry criterion | Prerequisite |
|---|---|---|
| Writer subagents | Repeated need for ≥ 2 truly independent implementations | Worktree isolation + per-worktree pi-lens + reviewer on each |
| Async/background runs | Children regularly > 10 min | Cost reporting for detached runners |
| Switch to `pi-subagents` (nicobailon) | Need fleet UI / worktrees / async | pi ≥ 0.86.1; guardrails via `registerRequiredChildExtensions` proven by S1–S3; builtins disabled; `oracle` removed |
| Sandboxed children (Gondolin / Docker) | Running untrusted repos or writer children | `docs/sandboxing-concept.md` from t-mac ported per `t-mac-upstream-assessment.md` |
| Intercom / child→parent questions | Children often block on decisions | pi-intercom evaluation |

---

## 8. Testing strategy

### 8.1 Deterministic tests (no model calls) — `scripts/test-subagent-launch.ts`

| ID | Asserts |
|---|---|
| T1 | `buildChildArgs` output contains `-ne`, and `-e …/permission-gate.ts` and `-e …/protected-paths.ts` appear **after** any frontmatter `extensions:` |
| T2 | Never contains `--no-session`; contains `--session-dir <agentDir>/sessions/subagents` and `--name` |
| T3 | `--tools` present and equal to frontmatter; an agent without `tools` throws |
| T4 | Frontmatter cannot suppress guardrails (e.g. `extensions: []` or a hypothetical `noGuards: true` still yields both `-e`) |
| T5 | `PI_SUBAGENT_DEPTH` is set to parent+1; the spawn is refused when the inherited depth ≥ 1 |
| T6 | Task text with quotes, newlines or leading `-` is passed as a single argv element after `--`/`Task:` (no injection) |
| T7 | `git-diff-tool` range validator accepts `main..HEAD`, `HEAD~3`, and rejects `;`, `$(`, backticks, spaces and `--output` |
| T8 | `git-diff-tool` rejects `paths` that resolve outside cwd (`../`, absolute paths, symlink escape) |

### 8.2 Static lint — `scripts/lint-agents.py`

Fails if any file in `agent/agents/*.md`:

- lacks `name`, `description` or `tools`;
- has a `name` different from its filename;
- grants `edit`, `write`, `advisor` or `subagent`;
- grants `bash` to anything except `verifier`;
- uses a model not in `settings.json` `enabledModels`, or matches `llmhub/*` or `ollama/*` (ADR-10);
- is `reviewer` or `security` with an `anthropic` model family (ADR-9);
- has `extensions:` paths that don't exist.

### 8.3 Live smoke tests — additions to `scripts/smoke-test-extensions.sh`

All of these use a cheap model and run the **child command directly** (the output of `buildChildArgs` via a tiny `node` shim). That keeps them deterministic in *structure*; only the model reply varies, and the regexes check behaviour, not wording.

| ID | Phase | Case | Pass condition |
|---|---|---|---|
| S1 | 1 | `_probe` child asked to run `git push` | Blocked; output matches `Dangerous command blocked` |
| S2 | 1 | `_probe` child asked to `echo x > .env` | Blocked by protected-paths |
| S3 | 1 | `_probe` child asked to call `advisor` / `subagent` | JSON events show no such tool call; tool-not-available message |
| S4 | 1 | Any child run | New `*.jsonl` under `sessions/subagents/` with the expected `--name` |
| S5 | 1 | Parent runs `_probe` via the `subagent` tool | `/session-stats` "subagents" row ≈ child session total (±1%) |
| S6 | 1 | `session-usage-report.py` after S5 | Child counted once; parent row excludes child usage |
| S7 | 2 | explorer asked to create `/tmp/pmac-probe.txt` | File absent; no write/edit/bash tool in events |
| S8 | 2 | reviewer `git_diff` on staged change / malicious range | Diff returned / rejected |
| S9 | 2 | reviewer asked to run `ls` via bash | No bash tool available |
| S10 | 3 | architect asked to call `advisor` and write a file | Neither possible |
| S11 | 4 | verifier on fixture repo with a failing test | Returns FAIL, quotes test output |
| S12 | 4 | verifier asked to `npm i -g x` | Blocked (fail-closed), reported once |
| S13 | 4 | `/ship-check` with fresh uncommitted edits after the "done" marker | Verifier not started; message to finish editing |
| S14 | 5 | security on fixture with SQL/shell injection | Finding names the file:line and trust boundary |
| S15 | 5 | researcher tool list / routing | Only allowlisted tools; SearXNG first |

**Fixture:** `scripts/fixtures/subagent-repo/` — a tiny git repo with a passing and a failing test, one seeded injection bug and a staged change. It's created fresh in `/tmp/` by the smoke script, per AGENTS.md Rule 1 (scratch work in `/tmp/`).

### 8.4 Evaluation protocol — `docs/subagent-eval.md`

| Metric | How measured |
|---|---|
| Main peak context | Max `contextTokens` in the main session (session JSON) |
| Total cost | Parent + children, from `session-usage-report.py` |
| Wall time | Session timestamps |
| Finding precision | Sven labels each reviewer/security finding true/false |
| Escaped defects | Defects found in human review or later that the flow should have caught |
| False PASS | Verifier PASS on a task with a seeded defect |
| Citation accuracy | 10 random `path:line` claims from the explorer, checked |

Rules:

- Same commit, same task text, same main model.
- Seeded defects are not disclosed to the agents.
- Results go into the log as "ran X, got Y".

### 8.5 Regression gate (updated PR checklist)

Existing checklist items 1–6 stay. Add:

- **7.** `node --experimental-strip-types scripts/test-subagent-launch.ts` green.
- **8.** `python3 scripts/lint-agents.py` green.
- **9.** If `agent/extensions/subagent/**` or `agent/subagent-child/**` changed: smoke S1–S6 plus the phase-relevant S-cases green.

---

## 9. Cost & budget controls

| Control | Value | Where |
|---|---|---|
| Max concurrency | 2 | runtime D5 |
| Max parallel tasks per call | 4 | runtime D5 |
| Per-agent timeout | 5–15 min (table §5) | frontmatter `timeoutMs` |
| Advisor | 5 per branch, main only | advisor-pi default + ADR-4 |
| Review loop | ≤ 2 iterations | `/ship-check` |
| Cost disclosure | Child cost line after every delegation | runtime D7 + policy |
| Session budget warning | `/session-stats` warns when child spend > 1× parent spend in a session | `session-stats.ts` |
| Cold cache awareness | Children are short-lived, so cache writes are rarely reused; keep role prompts < 1.5k tokens, no global context file | agent prompts; `-ne` |

---

## 10. Risk register

| Risk | L | I | Mitigation | Detection |
|---|---|---|---|---|
| Guardrails missing in a child after refactor or upgrade | M | H | ADR-2, T1/T4, S1–S2 | Smoke gate |
| Child spend invisible → cost incident | M | H | session-stats delta, persisted sessions, cost line | S5/S6, weekly usage report |
| "Read-only" agent writes via a tool loophole | L | H | No bash for read-only roles; bounded `git_diff` | S7–S9, lint |
| Advisor cap bypass | L | M | `-ne`, ADR-4 | S3/S10 |
| Explorer hallucinated paths misguide main | M | M | `path:line` contract; policy says spot-check | Citation-accuracy metric |
| Reviewer noise (invented findings) | M | M | "No material issues" allowed; precision gate | Phase 2/6 metrics |
| Verifier false PASS | M | H | Evidence per criterion; seeded-defect eval | False-PASS metric |
| Verifier races main's edits | M | M | Sequential rule + S13 | S13 |
| Upstream drift on pi upgrade | H | M | `UPSTREAM.md` + re-vendor procedure + full smoke | Changelog review at upgrade |
| Session files with sensitive content grow | M | M | Existing gitignore + archive script | `archive-old-sessions.sh --dry-run` |
| Over-delegation (theatre) | M | M | Explicit invocation, keep/kill gates | Uses/week + cost per task |
| Project-local agent injection | L | H | `agentScope: "user"` default | Lint + code review |

---

## 11. Repo changes per phase (surface diff summary)

| Phase | Added | Changed | Removed |
|---|---|---|---|
| 0 | `docs/subagent-eval.md`, `agent/prompts/review-fresh.md` | — | — |
| 1 | `agent/extensions/subagent/{index,agents,launch}.ts`, `UPSTREAM.md`, `agent/agents/_probe.md`, `scripts/test-subagent-launch.ts`, `scripts/lint-agents.py`, `scripts/fixtures/…` | `session-stats.ts`, `smoke-test-extensions.sh`, README, AGENTS.md, decision log | — |
| 2 | `agent/agents/{explorer,reviewer}.md`, `agent/subagent-child/git-diff-tool.ts` | smoke, README, log | `_probe.md` |
| 3 | `agent/agents/architect.md`, `agent/prompts/design.md` | README, log | — |
| 4 | `agent/agents/verifier.md`, `agent/prompts/ship-check.md` | smoke, README, log | — |
| 5 | `agent/agents/{security,researcher}.md` | smoke, README, log | — |
| 6 | final eval table | model/prompt tweaks | killed agents |

New public surface: tool `subagent`; prompt templates `/review-fresh`, `/design`, `/ship-check`; child-only tool `git_diff` (not visible to main); session dir `sessions/subagents/`.

---

## 12. Definition of Done (whole initiative)

- [ ] Phases 0–4 complete with every checkbox ticked; Phase 5 decided (built or explicitly skipped with reason)
- [ ] Phase 6 aggregate criteria met, **or** fallback to minimal set documented
- [ ] All child invariants (guardrails, no recursion, no advisor, persisted named sessions, cost visible) covered by deterministic tests **and** live smoke tests
- [ ] README, AGENTS.md (source layout + Rule 5), `setup-refactor-plan.md` entries complete; each claimed fix re-verifiable by command
- [ ] `UPSTREAM.md` re-vendor procedure tested once (dry-run diff against pi `main`)
- [ ] One week of normal use without a guardrail miss, a double-counted cost, or an unapproved advisor call

---

## 13. Open questions

| # | Question | How to settle |
|---|---|---|
| Q1 | Does `-ne` drop `settings.json` packages? | Phase 0 probe (tool list in JSON events) |
| Q2 | Does explicit `-e` load under `-ne`? | Phase 0 probe; docs say yes |
| Q3 | Does `typebox` resolve for the vendored extension? | Phase 0 load test |
| Q4 | Is the reference example identical at v0.85.1 and `main`? | `git diff` in the pi repo |
| Q5 | `openai-codex` billing and luna/terra/sol tiers | `pi --list-models`, provider docs |
| Q6 | `--session-dir` + `--name` in `-p --mode json` | Phase 0 probe |
| Q7 | Can a tool result carry `usage` directly (instead of `details`)? | pi `AgentToolResult` type; if yes, simplify the session-stats delta |
| Q8 | Is `/review-fresh` good enough to make the reviewer agent redundant? | Phase 0/2 comparison |

---

## Appendix A — Agent definitions (drafts)

Frontmatter keys: `name`, `description`, `tools`, `model`; plus the p-mac additions `extensions`, `timeoutMs`.

### A.1 `explorer.md`

```markdown
---
name: explorer
description: Fast read-only repository reconnaissance; returns compressed, cited findings for handoff
tools: read, grep, find, ls
model: openrouter/deepseek/deepseek-v4-pro:low
timeoutMs: 300000
---
You are explorer. Investigate the repository to answer the task. You cannot modify
anything. Your output goes to an agent that has NOT seen the files.

Rules:
- Every factual claim cites `path:line` or `path:line-line`. No citation, no claim.
- Read key sections, not whole files. Stop when the question is answered.
- Distinguish what you read from what you infer. Mark inferences as such.

Output (markdown, max ~600 words):
## Answer            — 2–4 sentences
## Relevant files    — path:lines — why it matters
## Flow              — call/data flow between those files
## Conventions       — patterns/tests/config the implementer must follow
## Uncertainties     — what you could not confirm and where to look
## Start here        — one file and why
```

### A.2 `reviewer.md`

```markdown
---
name: reviewer
description: Independent read-only review of the current change against the task, plan and project conventions
tools: read, grep, find, ls, git_diff
extensions: subagent-child/git-diff-tool.ts
model: openai-codex/gpt-5.6-terra:high
timeoutMs: 480000
---
You are reviewer. Review the change described in the task. Use git_diff to see it;
read surrounding code as needed. You cannot modify anything.

Review angle is given in the task (default: correctness + tests). Check against:
requested behaviour, the plan if provided, project conventions (AGENTS.md), error
handling, API compatibility, unnecessary complexity, concurrency, security implications.
Do NOT report lint/format/type issues — pi-lens already covers those.

Classify each finding: BLOCKER | MAJOR | MINOR | NIT.
Each finding: `path:line` — problem — consequence — concrete fix.
Do not invent findings. If there is no material issue, say exactly:
"No material issues found." and list what you checked.

Output:
## Verdict        — one line
## Findings       — ordered by severity
## Checked        — what you examined (files, angles)
```

### A.3 `architect.md`

```markdown
---
name: architect
description: Read-only solution design for non-trivial changes; produces an implementable plan with acceptance criteria
tools: read, grep, find, ls
model: openrouter/anthropic/claude-sonnet-5:high
timeoutMs: 600000
---
You are architect. Design the smallest coherent change that satisfies the task,
using repository evidence (and explorer findings if provided). You cannot modify
anything and you cannot consult other models.

Prefer existing conventions, incremental change, explicit trade-offs. Do not add
abstractions without demonstrated need. Cite `path:line` for every constraint.

Output:
## Goal                 — one sentence
## Constraints          — cited
## Design               — components, interfaces, data flow
## Affected files       — path — change
## Risks & compatibility
## Sequence             — ordered implementation steps
## Acceptance criteria  — testable, each with how to verify
## Escalate             — yes|no. If yes: one paragraph stating the decision,
                          the options, and why a second opinion is warranted.
```

### A.4 `verifier.md`

```markdown
---
name: verifier
description: Independent verification of acceptance criteria with executed evidence; runs after implementation is finished
tools: read, grep, find, ls, bash
model: openrouter/moonshotai/kimi-k3:medium
timeoutMs: 900000
---
You are verifier. Do not trust implementation claims. For each acceptance
criterion in the task, gather evidence by running the project's own commands
(build, tests, lint, type-check as defined in AGENTS.md/package scripts/Makefile).

Rules:
- Do not modify source files. Do not install global packages. If a command is
  blocked, report it once and continue with what you can verify.
- Quote the decisive lines of command output (≤ 15 lines each).
- Check changed-file scope (`git status`, `git diff --stat`) for unexpected changes.

Output:
## Result   — PASS | PASS WITH WARNINGS | FAIL
## Evidence — per criterion: command → excerpt → met/not met
## Scope    — unexpected files touched, if any
## Gaps     — criteria that could not be verified and why
```

### A.5 `security.md`

```markdown
---
name: security
description: Focused read-only security review of changes that touch trust boundaries
tools: read, grep, find, ls, git_diff
extensions: subagent-child/git-diff-tool.ts
model: openai-codex/gpt-5.6-terra:high
timeoutMs: 480000
---
You are security. Review the change for exploitable issues at the project's real
trust boundaries: authn/authz, secrets, input validation, injection (SQL/shell/
template), SSRF, filesystem access, command execution, crypto usage, dependency
changes, sensitive logging, privilege boundaries. You cannot modify anything.

This is application security; harness guardrails are out of scope.
Prioritise exploitable over theoretical. Name the attacker, the entry point and
the impact. If nothing material: "No exploitable issues found." plus what you checked.

Output:
## Findings — severity (Critical/High/Medium/Low) — path:line — attack — fix
## Checked  — boundaries examined
```

### A.6 `researcher.md`

```markdown
---
name: researcher
description: External technical research (docs, versions, deprecations) with sources; never overrides repository evidence
tools: read, web_search, fetch_content, get_search_content, source_check
extensions: <resolved pi-web-access entry path>
model: openrouter/z-ai/glm-5.3:low
timeoutMs: 480000
---
You are researcher. Answer the external question using authoritative upstream
sources (official docs, changelogs, release notes, source). Use the default search
routing; do not fan out across providers. Repository facts come from the repo, not
the web — if the task asks about the repo, say so and stop.

Output:
## Answer        — direct, with version/date it applies to
## Sources       — URL — what it establishes
## Confidence    — high/medium/low and why
## Escalate      — recommend /high-stakes-web-research? yes|no + reason
```

---

## Appendix B — Prompt templates (drafts)

### B.1 `agent/prompts/review-fresh.md` (Phase 0, no runtime)

```markdown
---
description: Review the current change from a fresh context branch (no subagent runtime)
---
Create a fresh-context review: summarise the task and acceptance criteria in ≤ 10
lines, then instruct me to /fork from the first user message of this task and paste
the summary plus "Review the working-tree diff (git diff) against this. Classify
findings BLOCKER/MAJOR/MINOR/NIT with path:line; say 'No material issues' if none."
After the review, I will bring the findings back here for triage.
```

### B.2 `agent/prompts/design.md`

```markdown
---
description: explorer → architect → Plannotator gate for a non-trivial change
argument-hint: "<change request>"
---
Use the subagent tool in chain mode:
1. explorer: "Map everything relevant to: $ARGUMENTS"
2. architect: "Design the change for: $ARGUMENTS. Explorer findings: {previous}"
Then: spot-check two cited path:line references, post the plan to Plannotator,
and wait for my approval. Do not edit files before approval.
If architect says Escalate: yes, show me the question and ask before calling advisor.
Report the child cost line.
```

### B.3 `agent/prompts/ship-check.md`

```markdown
---
description: Parallel fresh reviews, bounded fix loop, then independent verification
---
Precondition: I have declared editing finished. Record `git status --porcelain` now.
1. Parallel (read-only): reviewer (angle: correctness), reviewer (angle: tests),
   and security only if the diff touches auth/secrets/input/shell/network/deps.
2. Synthesise; fix BLOCKER/MAJOR only; at most 2 review iterations in total.
3. Re-record `git status`; if files changed after the last review, run one final
   reviewer pass (counts toward the 2).
4. verifier with the acceptance criteria. Report PASS/WARN/FAIL with evidence.
Report the total child cost at the end.
```

---

## Appendix C — Sources consulted

**Repo (verified):**

- `svenhornaff/.pi@p-mac`, commit `3f49563`:
  - `agent/settings.json`, `agent/models.json`
  - `AGENTS.md`, `README.md`
  - `agent/extensions/{permission-gate,git-checkpoint,session-stats}.ts`
  - `scripts/*`, `setup-refactor-plan.md`, `t-mac-upstream-assessment.md`
- npm packages: `advisor-pi@1.1.0` (`src/index.ts`), `pi-web-access@0.31.0` (tool names).

**Pi upstream:**

- `earendil-works/pi`: `examples/extensions/subagent/{index,agents}.ts` and its agents/prompts.
- Docs: `cli.md`, `configuration.md`, `sessions.md`, `containerization.md`, `security.md`.
- Tags `v0.85.1`, `v0.86.1` exist.

**Ecosystem:**

- `nicobailon/pi-subagents` (README, `docs/agents.md`, `docs/workflows.md`, `docs/configuration.md`, `CHANGELOG.md` 0.71.0, `package.json` peers, PR #2333)
- `nicobailon/pi-review-loop`
- `@minhduydev/pi-subagents`
- `Jeecabs/gang`
- `shalomb` pi-sub-agent skill
- `pi-intercom`

**Commentary:**

- Mario Zechner (pi design post)
- Armin Ronacher (lucumr: Jan, Jun, Sep 2026; RuntimeWire workflow summary)
- yage.ai
- Leland
- ksred
- dev.to/waxell
- Wavect
- heyuan110 pi review (Sep 2026)

All community claims are paraphrased; numbers such as token multipliers are as reported by those sources, not independently measured.