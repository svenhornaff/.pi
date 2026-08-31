# Sandboxing concept for trusted-project untrusted-input exposure

Status: 🟡 Concept only — no implementation yet. Tracked from
`setup-refactor-plan.md`'s "Recommended next steps" item 6 (lowest urgency,
last open item from that list).

## 1. The problem statement

`agent/trust.json` marks a project directory as trusted, which lets pi run
tools (bash, file write/edit, MCP calls) there without a per-action prompt.
**Trust is a friction reducer for the operator, not an isolation boundary
for the content pi processes.** Two things globally installed in this
config make that gap concrete:

- **`pi-web-access`** (`agent/npm/node_modules/pi-web-access`, enabled via
  `"npm:pi-web-access"` in `agent/settings.json`) lets any session in any
  trusted project fetch arbitrary URLs. There's no per-project allow/deny
  list — it's all-or-nothing at the global settings level.
- **`permission-gate.ts` / `protected-paths.ts`** are regex/substring
  guardrails on the *local* bash/file surface (see `AGENTS.md`: "not a
  sandbox"). They reduce the blast radius of an obviously-dangerous literal
  command but do nothing about a model that's been steered by content it
  just read — e.g. a fetched web page or an issue/PR body containing
  prompt-injection text that asks it to exfiltrate a file via a *not
  obviously dangerous* command, or to quietly widen its own future
  permissions.

So the actual risk isn't "a trusted project might do something malicious on
purpose" — it's: **a trusted project that ingests untrusted external
content (issue/PR text, fetched web pages, arbitrary email/doc contents)
gives that untrusted content the same ambient privilege as the operator**,
bounded only by the guardrail extensions' regex coverage, not by a real
process/filesystem/network boundary.

## 2. Correction on current trust state

`setup-refactor-plan.md` names three candidate projects for this concern —
`bulliexplorer`, `doc-manager`, `idp-docs`. Checked against the live
`agent/trust.json` on this machine (2026-08-31):

```json
{
  "/Users/A94984797": true,
  "/Users/A94984797/Workspace/cv-review/.pi": true,
  "/Users/A94984797/Workspace/idp_contracts": true,
  "/Users/A94984797/Workspace/pi-tools": true
}
```

**None of the three named projects are actually in this file.** The table
those names came from (`Pi-Setup-Guide.md` §7, `/Users/brooklyn/Workspace/...`)
is a different username and is illustrative/generic, not this machine's
live trust list. This doc's job is to define the concept correctly enough
that whichever real trusted project ends up needing it later can be slotted
in — so the concept below is written against the **real current list**
(`~`, `cv-review/.pi`, `idp_contracts`, `pi-tools`) plus a placeholder for
whatever gets added next, rather than against project names that don't
currently exist in config.

**Action for whoever revisits this:** before doing anything else here, run
the same `cat agent/trust.json` check again — trust entries change over
time and this doc will go stale exactly the way `Pi-Setup-Guide.md` did.

## 3. Which of the current trusted projects plausibly need this

Untrusted-input exposure requires the project to *actually* process
external content, not just exist. Quick triage, to be confirmed by whoever
owns each project rather than assumed here:

| Trusted path | Plausible untrusted-input surface? | Notes |
| --- | --- | --- |
| `~/.pi` (this config repo) | No | Self-contained config; the only "external content" is documentation/plan text written by the operator. |
| `Workspace/cv-review/.pi` | **Likely** | CV/resume review implies ingesting external documents (candidate-submitted files) by definition. |
| `Workspace/idp_contracts` | **Possible** | "Contracts" suggests third-party-authored documents; depends whether pi reads raw contract text/attachments directly. |
| `Workspace/pi-tools` | Unclear | Depends on what's actually built there; check for web-fetch or issue/PR ingestion in its own code before assuming either way. |

This table is a starting triage, not a decision — each project owner should
confirm actual untrusted-input flows before prioritizing sandboxing work.

## 4. Sandboxing options, ordered cheapest → most isolating

### Option A — Scope `pi-web-access` per project (cheapest, partial)

Move the URL-fetch capability from a global `agent/settings.json` package
to a project-local enable, so projects that don't need it don't carry the
exposure at all. Reduces the blast radius (fewer projects can fetch
arbitrary URLs) but does nothing for issue/PR-body-as-prompt-injection risk
inside a project that *does* need fetch. Lowest effort, addresses the
narrowest slice of the actual risk.

### Option B — Run untrusted-input turns in a disposable container/VM

For a project identified as processing untrusted input (per §3), run the
session (or at minimum the tool-execution backend) inside a container with:

- no credential access (no Keychain, no `agent/auth.json` mount),
- a read-only or scratch-only filesystem view of the project except an
  explicit output directory,
- no outbound network except the specific fetch/API endpoints that project
  actually needs (not a blanket allow).

This is real isolation, but it's genuinely **structural work** (per the
plan doc's own framing) — a different execution model per project, not an
extension tweak. Needs its own decision on tooling (Docker, a macOS
sandbox-exec profile, or a VM) before implementation starts.

### Option C — Two-pass "quarantine then re-inject" pattern

For the injection-via-fetched-content risk specifically: fetch/read
untrusted content in a pass that has **no tool access at all** (pure
text-in, text-out), then hand only the extracted, structured result to a
second pass that has normal tool access. Cheaper than Option B, but only
mitigates prompt injection — doesn't help with credential/filesystem
exposure if the *first* pass is itself compromised by content designed to
look like a benign extraction target.

### Recommendation

Don't pick an option yet. First close the actual gap in §3 — confirm which
trusted projects (if any) really ingest untrusted external content — and
size the option to that answer. If it turns out none of the four currently
trusted projects do, this item drops to "no action needed, revisit if a
new untrusted-input project gets trust"; if one or more do, Option C is the
proportionate first step (cheap, addresses the more likely real trigger —
prompt injection via fetched content — without a container rebuild
project), with Option B reserved for a project handling genuinely sensitive
data (e.g. `cv-review` real candidate PII) where a text-only quarantine
pass isn't reassurance enough.

## 5. Non-goals for this doc

- Not proposing to weaken or replace `permission-gate.ts` /
  `protected-paths.ts` — those stay as the local guardrail layer regardless
  of what sandboxing gets added on top (per `AGENTS.md` rule 3: never
  remove/weaken without an equivalent-or-stronger replacement).
- Not proposing a change to `agent/trust.json` semantics — trust-as-friction-
  reducer is a reasonable model; this doc is about adding a *second*,
  independent layer for the untrusted-input case, not redefining trust.
- Not committing to a specific container/VM tool choice — that's an
  implementation decision for whenever Option B is actually triggered.

## 6. Status

Open. No action taken beyond writing this concept and correcting the
project-name mismatch found in §2. Next concrete step is the triage in §3
— get a real answer per trusted project before sizing further work.
