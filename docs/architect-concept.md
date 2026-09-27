# `architect` tool — concept

*Status: proposal · 2026-09-27 · Scope: `~/.pi` branch `p-mac` · Owner: Sven*
*Implementation: local, in VS Code with pi. This file is the brief.*

---

## 1. Why

The subagent layer (tag `subagent-attempt-1`) was reverted as too heavy. What remains
worth having from it is **independent design judgement before implementation**: a
second model that turns gathered evidence into a structured plan, which you then approve
in Plannotator.

`advisor-pi` already proves a much lighter mechanism for that. It is **one extra model
call made from inside the running pi session**:

- no second pi process and no child session;
- no tools, so it cannot read, write or run anything;
- it receives a fixed system prompt, the current conversation (capped), and the
  executor's question plus optional context;
- it returns text; a per-branch use counter caps spend.

`architect` reuses exactly this mechanism, with a different job, output format, model and cap.

## 2. Goals and non-goals

**Goals**

- Main session can call `architect(question, context)` for a non-trivial change and get
  back a plan in a fixed structure.
- The plan is grounded only in evidence main has put into the conversation or `context`.
- Spend is capped per session branch and visible in `/session-stats`.
- No new process, no guardrail changes, no new npm package.

**Non-goals**

- Reading the repository itself (it has no tools, by design).
- Writing or editing files. Main writes `PLAN.md`; you approve in Plannotator.
- Replacing `advisor`. Advisor stays the escalation path for hard trade-offs.
- Personas, agent directories, benchmark frameworks. See §10 for the only allowed generalisation.

## 3. How it fits

```text
you ──prompt──▶ main pi session (sonnet-5, medium)
                  │ 1. reads the relevant files (normal tools, guardrails apply)
                  │ 2. architect(question, context = excerpts it read)
                  ▼
            architect tool ── completeSimple ──▶ gpt-5.6-terra (high)
                  │            system prompt + question + context + transcript (≤ 20k chars)
                  ▼
            structured plan (text + usage)
                  │ 3. main writes PLAN.md
                  ▼
            Plannotator ──▶ you approve / annotate
                  │ 4. if plan says "Escalate: yes" → main asks you → advisor()
                  ▼
            main implements (unchanged flow)
```

| | `advisor` (existing) | `architect` (new) |
|---|---|---|
| Question it answers | "What should I do next / am I going wrong?" | "What is the smallest coherent design for this change?" |
| Output | free-form guidance | fixed sections (§6) |
| Default model | `openai-codex/gpt-5.6-sol`, high | `openai-codex/gpt-5.6-terra`, high (different family from main) |
| Cap | 5 per branch | 3 per branch |
| Tools | none | none |

## 4. Implementation shape

One file: `agent/extensions/architect.ts` (target ≤ 200 lines). Use
`advisor-pi@1.1.0` `src/index.ts` as the reference and copy its mechanism, not its
feature set:

| Concern | Do what advisor-pi does |
|---|---|
| Model call | `completeSimple(model, { systemPrompt, messages: [userMessage] }, { apiKey, headers, signal, reasoning, maxTokens, timeoutMs, cacheRetention, sessionId })` from `@earendil-works/pi-ai` |
| Model + auth | `ctx.modelRegistry.find(provider, id)` and `ctx.modelRegistry.getApiKeyAndHeaders(model)`; fail with a clear message if the model does not resolve |
| Transcript | `buildSessionContext(entries, leafId)` → `convertToLlm(...)` → `serializeConversation(...)` from `@earendil-works/pi-coding-agent`, then keep the most recent N chars with a truncation marker |
| Cap state | persist `{ useCount }` with `pi.appendEntry("architect-state", …)`; restore on `session_start` and `session_tree` by scanning the current branch for the latest `custom` entry of that type |
| Executor guidance | `before_agent_start`: append 3–4 lines to the system prompt saying when to use `architect` and how many uses remain |
| Result | `content`: the plan text with a one-line header (`Architect plan (n/3, model, thinking)`); `details.architect`: provider, model, useCount, maxUses, elapsedMs, stopReason, **usage** |

Leave out of the first version: CLI flags, a cache-retention setting, a footer status line
(the footer budget is 3 lines and already full), and legacy-model migration. Keep one
command.

### Tool schema

```ts
architect({
  question: string,          // the change to design, in one or two sentences
  context?: string,          // excerpts main has read: paths, line ranges, snippets, constraints
  constraints?: string,      // explicit must/must-not from the user
})
```

The tool description must say plainly: *"The architect cannot read files. Put every code
excerpt and path it needs into `context`. Call it after investigating, not instead of it."*

### Command

```text
/architect status | enable | disable | model <provider>/<id> | thinking <level> | max-uses <n>
```

Defaults: enabled, `openai-codex/gpt-5.6-terra`, `high`, max uses 3, max transcript
20,000 chars, max output tokens 4,000, timeout 600 s. Settings are session state only,
as in advisor-pi; no new keys in `settings.json` for v1.

## 5. System prompt (draft)

```text
You are the architect for a Pi coding session. You design; you do not implement.
You have no tools. Everything you know about the codebase is in the question, the
context, and the conversation transcript below.

Rules:
- Ground every constraint and affected file in evidence from the input. Cite it as
  path:line when the input gives lines. If a needed fact is missing, list it under
  Open questions instead of assuming.
- Prefer the smallest coherent change that follows existing conventions. No new
  abstractions without a stated, concrete need.
- Make trade-offs explicit. If one decision is genuinely hard or high-risk, say so
  under Escalate.
- Be concise. Do not restate the transcript.

Return exactly these sections:
## Goal            one sentence
## Constraints     bullet list, each with its evidence
## Design          components, interfaces, data flow
## Affected files  path — change
## Risks           including compatibility and security where relevant
## Sequence        ordered implementation steps
## Acceptance      testable criteria, each with how to verify
## Open questions  facts the architect needed but did not have
## Escalate        yes|no — if yes, one paragraph: the decision, the options, why
```

## 6. Usage flow

Add `agent/prompts/design.md`:

```markdown
---
description: Evidence first, then architect, then Plannotator approval
argument-hint: "<change request>"
---
Design this change before implementing it: $ARGUMENTS

1. Investigate: read the files and tests that matter. Keep notes of paths and line ranges.
2. Call `architect` once, with the change as `question` and the relevant excerpts
   (paths, line ranges, short snippets, constraints) as `context`.
3. If the plan lists open questions you can answer by reading more code, do so and
   call `architect` once more at most. Otherwise ask me.
4. Write the plan to PLAN.md and open it in Plannotator. Do not edit other files until
   I approve.
5. If the plan says "Escalate: yes", show me the question and ask before calling `advisor`.
```

Typical use: `/design add GPX export per route page`. For small changes, skip it and work
as today.

## 7. Cost visibility (also fixes advisor)

`advisor-pi` reports its token usage in `details.advisor.usage`, not on the tool-result
message. `session-stats.ts` only sums `message.usage`, so **advisor spend is invisible to
`/session-stats` today**; `architect` would have the same gap.

Change in `session-stats.ts`: for `toolResult` messages whose `toolName` is `advisor` or
`architect`, add `details.<toolName>.usage` to the totals, bucketed under provider
`(advisor)` / `(architect)` with the model from `details.<toolName>.model`. Do not
double-count if a future version also sets `message.usage`.

`openai-codex` is subscription-billed, so costs may read as 0 while tokens are real.
Show tokens even when cost is 0.

## 8. Tests and "done" gate

Follow `AGENTS.md`: guardrail files are untouched, but the smoke test is still the gate
for any extension change.

Add to `scripts/smoke-test-extensions.sh`:

| Case | Pass condition |
|---|---|
| A1 load | `pi -p` with tools loads with no errors; the tool list includes `architect` |
| A2 disabled | after `/architect disable` (or a flag-free equivalent in `-p`: skip if not scriptable) the tool returns a disabled message, no model call |
| A3 cap | with max uses 0 or after the cap, the tool refuses without a model call |

Manual checks, recorded in the decision log as "ran X, got Y":

- one real `/design` run on a small change in a trusted project: plan has all sections;
  every cited `path:line` appears in the context main supplied;
- `/session-stats` shows an `(architect)` row, and an `(advisor)` row after one advisor call;
- `/architect status` shows uses remaining; `/tree` to an earlier point restores the
  correct count.

## 9. Done when

- [ ] `agent/extensions/architect.ts` loads; `architect` tool and `/architect` command registered
- [ ] Schema, defaults and system prompt as in §4–§5
- [ ] Use count persists per branch and survives `/tree` and resume
- [ ] `session-stats.ts` counts `advisor` and `architect` usage from `details`
- [ ] `agent/prompts/design.md` added
- [ ] Smoke test green including A1–A3 (or A2 documented as manual if not scriptable)
- [ ] Manual checks in §8 done and logged
- [ ] `README.md` extension + prompt tables, `Pi-Setup-Guide.md` §5/§7, and a
      `setup-refactor-plan.md` entry updated; public-surface diff stated
- [ ] JSON configs validated; `git status` clean of secrets, sessions, backups

**Rollback:** rename `architect.ts` to `architect.ts.disabled`, delete `design.md`. The
`session-stats.ts` change stays (it fixes advisor too).

## 10. Open points for the implementer

- **typebox:** advisor-pi imports `Type` from `typebox`. On 2026-09-23 `typebox` did not
  resolve from `agent/extensions/` without an explicit dependency. First check whether
  `@earendil-works/pi-ai` or `pi-coding-agent` re-exports `Type`; if not, add
  `"typebox": "1.3.27"` to `agent/extensions/package.json`. Do not add
  `"type": "module"` unless loading actually fails without it.
- **Model choice:** start with `gpt-5.6-terra`; switch with `/architect model` after a few
  real uses. Keep it in a different model family from the main session.
- **Later, only if two consultants exist and both earn their keep:** generalise to one
  `consult` tool reading `agent/consultants/*.md` (frontmatter: model, thinking,
  max-uses; body: system prompt). Not in v1.

## 11. Also in this pass (small, unrelated)

`docs/p-mac-harness.html`, first diagram ("How a turn runs"):

- the result path ends in `pi-condense`; it must end at the **pi agent loop**;
- the "block + reason" label overlaps the permission-gate box; move it left/up;
- the `tool_result` pill sits on top of its line; offset it or break the line around it.