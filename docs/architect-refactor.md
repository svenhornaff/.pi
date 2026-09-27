# `architect` — refactor delta to the initial concept

*2026-09-27 · Applies on top of the first version of `docs/architect-concept.md`, which is already being implemented.*
*Goal: make `architect` behave like `advisor`. Main calls it on its own when a change needs design, and when the user asks ("consult the architect"). `/design` becomes a shortcut, not the only entry.*

Nothing in the call mechanism, cap state, schema, system prompt, session-stats change or diagram fixes changes. Only the invocation text, the tests and the checklist change.

---

## R1 — Tool description (replace)

Use this exact LLM-facing description for the `architect` tool:

```text
Consult the architect: a separate higher-capability model that turns evidence you have
gathered into a structured design plan (goal, constraints, design, affected files, risks,
sequence, acceptance criteria, open questions, escalation). It has no tools and cannot
read files: put every relevant path, line range and code excerpt into `context`. Call it
after investigating the code, not instead of it.
```

## R2 — Executor guidance (replace the "3–4 lines")

The `before_agent_start` handler appends this block to the system prompt every turn while
the tool is enabled, with the placeholders filled from live state. This block is what makes
autonomous use work. Tighten wording if needed; don't change the rules.

```text
Architect is enabled: <provider>/<model>, <thinking> thinking, <remaining>/<max> uses left
on this branch.
Call `architect` when:
- the user asks for it ("consult/ask the architect", "get a design first", "/design"), or
- before implementing a change that adds a component, crosses a module boundary, changes
  a public interface or data model, or touches more than ~3 files — once you have read the
  relevant code.
Do not call it for single-file fixes, renames, formatting, questions, or exploration.
Say in one line that you are consulting the architect and why. After a plan returns,
present it (or write PLAN.md when asked for a plan) before implementing.
Architect vs advisor: architect produces the design for a change; advisor gives strategic
advice when you are stuck, see risk, or need to correct course. If the architect's plan
says "Escalate: yes", ask the user before calling advisor. If the user asks for both,
call architect first, then advisor with the plan as context.
When no uses are left, say so and continue without it.
```

Rules for the handler:

- Inject nothing when the tool is disabled. When the cap is reached, keep only the first line (with `0/<max>`) and the last line.
- No hooks that force or auto-trigger calls. Main decides, like with `advisor`.

## R3 — `/design` wording

Keep `agent/prompts/design.md` as is. In the concept and README, describe it as:

> `/design` is a shortcut that forces the full evidence → plan → PLAN.md → Plannotator gate. Without it, main still calls `architect` on its own (R2), and you can just say "consult the architect".

## R4 — Behaviour checks (add to §8)

These are manual and interactive, in a trusted project. Log the relevant transcript lines as "ran X, got Y".

| Case | Prompt | Pass condition |
|---|---|---|
| B1 explicit | "Let's consult the architect about <real multi-file change>" | Exactly one `architect` call, after at least one `read`/`grep`. |
| B2 autonomous | A real change touching ≥ 3 files, with no mention of the architect | Main announces and calls `architect` before its first `edit`/`write`. |
| B3 restraint | A single-file fix | No `architect` call. |
| B4 both | "ask the architect and the advisor about <change>" | `architect` precedes `advisor`; the advisor's `context` contains the plan. |
| B5 cap | After 3 calls on one branch | Main states the cap and continues without calling. |

If B2 fails, revise the R2 text once and re-run. Don't add forcing hooks.

## R5 — Done-when (replace / add lines in §9)

- [ ] Schema, defaults, tool description (R1), executor guidance (R2) and system prompt as specified
- [ ] Guidance is injected only while enabled; the reduced form applies at the cap
- [ ] Behaviour checks B1–B5 pass (B2 may need one guidance revision; log it)

## R6 — Documentation

- `README.md` / `Pi-Setup-Guide.md`: describe `architect` as "called by the agent when a change needs design, or on request; `/design` forces the full gate".
- Root `AGENTS.md`, *Source layout*: one entry for `architect.ts`. It should say where the invocation rules live (the extension's injected guidance) and that the rules must not be duplicated into context files. See R7.
- `setup-refactor-plan.md`: log this refactor as its own entry.

## R7 — Where the "when to call" rule lives

The rule lives in the extension's injected guidance (R2) only. It isn't copied into `AGENTS.md`, for these reasons:

- **Wrong scope.** `~/.pi/AGENTS.md` is project context for maintaining `~/.pi`. It loads only when pi runs inside `~/.pi`, so it wouldn't affect any other project.
- **It goes stale.** A global `~/.pi/agent/AGENTS.md` would load everywhere, but it can't know whether the tool is enabled or how many uses are left. It would keep telling the model to call a disabled or exhausted tool.
- **Two sources drift.** The rule would then be edited in one place and not the other.

Project-specific policy is the exception. A project's own `AGENTS.md` may add one line when that project needs a stricter or looser rule. For example: "Changes under `src/auth/` always go through the architect first", or "Don't use the architect in this repo". This narrows the global rule for that project; it doesn't restate it.