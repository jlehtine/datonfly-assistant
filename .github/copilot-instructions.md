# Copilot Instructions

Follow the architecture described in [README.md](../README.md) and the coding
conventions in [CONVENTIONS.md](../CONVENTIONS.md). This file contains only
agent-specific workflow rules. General project conventions live in those files —
do not duplicate them here.

## Development Phase

This software is in initial development and has not been released. Inter-package
API compatibility does not need to be maintained. Prefer simplifications over
backward-compatible changes when refactoring across packages.

The one exception is **persisted data**: there are active test deployments of
the standalone chat app, so database schema and stored data must be handled
carefully. Always use data-preserving migrations; never drop or alter data in a
destructive way.

## Decision Making

Stick to the agreed plan. If during implementation you encounter unforeseen
complications, inconsistencies, or ambiguities — stop, describe the problem and
the available options to the user, and ask how to proceed before continuing.

If you cannot ask the user questions (e.g. in an autonomous/Autopilot mode where
no interactive prompt is available), do **not** guess at a significant change of
plan or work around the blocker on your own. Instead, halt and report: describe
the blocker, the decision(s) that need to be made, and the options you see, then
end your turn and wait for the user. Continue autonomously only for changes that
clearly fall within the agreed plan.

## Planning and Progress

Use [TODO.md](../TODO.md) to track unresolved issues and planned features at a
high level — not sequenced plans. Follow the rules documented at the top of that
file.

Write a step-by-step plan to a per-task file under `tasks/<year>/<label>.md`
when the user asks for a plan — not routinely before starting work. Most
changes, including multi-file bug fixes, need no plan file; just make the
change. When in doubt, ask rather than writing one unprompted.

In that path, `<year>` is the calendar year the task was started and `<label>`
names the task or feature — typically the same label used for its feature branch
(e.g. `tasks/2026/composer-remount-fix.md` for a branch named
`composer-remount-fix`). Link the plan file from the relevant `TODO.md` entry if
one exists. Neither `TODO.md` nor the `tasks/` plan files are permanent
documentation — durable facts belong in the long-lived docs (README,
CONVENTIONS).

**Structure.** Express individual steps as GitHub-style task list items so
progress is visible at a glance:

- `- [ ]` — not started or in progress
- `- [x]` — completed

**Numeric identifiers.** When work is sequenced into phases, number them so they
sort and read in execution order. Top-level phases are `## Phase N —
<title>` with an increasing integer `N` (`Phase 0`, `Phase 1`, …); subsections
use a dotted `### N.M <title>` form where `M` increases within the phase
(`0.1`, `0.2`, `1.1`, …).

Numbers become stable identifiers once a plan is **committed** or once any of
its steps have been **executed** — from that point they may be referenced from
commits, branches, review comments and conversations, so never renumber them.
Assign the next unused number to later work instead; if something must slot
between existing items, append it with the next free number (or a deeper `N.M.K`
level) rather than shifting the others.

Before that point — while a plan is still uncommitted and no step has run — it
is just a draft. Renumber it freely into a clean sequence, and reorganise or
delete parts of it as the plan changes. A draft plan does not need to record its
own revision history: earlier drafts, superseded structures and abandoned step
numbering carry no value once nothing references them. Rationale is the
exception — preserve the reasoning behind rejected alternatives and the insights
found while planning, since those constrain future changes, but state them as
current fact rather than as a narrative of what an earlier draft said.

Keep steps concrete and actionable, ordered by dependency where it matters. Put
brief context, decisions, or rationale inline under a section when it helps a
future reader pick the work up.

**Tracking progress.** As work lands, flip its checkbox to `- [x]` in the same
change. Add newly discovered steps as you go rather than leaving them implicit,
and split a step that grew too large into smaller checkable items.

**Cleanup.** Do not delete completed steps or plan files as part of normal work
— leave completed steps as `- [x]` so the file shows what has been done. Remove
(clean up) a plan file only when the user explicitly asks, and only after any
durable facts in it have been migrated into the permanent docs
([README.md](../README.md), [CONVENTIONS.md](../CONVENTIONS.md), and related
files), and its corresponding entry (if any) in `TODO.md` has been resolved or
removed. Cleanup is a documentation step, not a plain deletion: nothing of
lasting value should be lost when a plan file is removed.

## Dependency Licensing

Vet the license of any third-party dependency before adding it.

- **Dependencies that contribute code to the final application** (compiled,
  bundled, or otherwise linked into shipped artifacts) must use MIT, BSD, Apache
  2.0, or a similarly permissive license. Do **not** add copyleft-licensed
  dependencies (e.g. GPL, LGPL, AGPL, MPL) to this category.
- **Pure runtime dependencies** (platform components invoked as separate
  processes/services and not linked into the application) may additionally use
  copyleft licenses.

If a dependency's license is unclear or does not fit these rules, stop and ask
the user before adding it.

## Linting

After code changes, run `pnpm lint:fix` and fix any linting errors caused by the
changes. Formatting is applied automatically by a commit hook, so there is no
need to check formatting.

## Version Control

Do not commit changes unless the user explicitly asks you to. Stage and make
commits only on explicit user permission or instruction.

Merge a feature branch with a merge commit, not a fast-forward or squash:
`git merge --no-ff --no-edit`.

## Testing

After implementing a feature, decide whether the feature warrants unit tests or
end-to-end tests. If so, implement the required tests and verify they pass.

**Run only the specific test file(s) relevant to the change** (e.g.
`pnpm exec playwright test tests/thread-management.spec.ts`). Running the entire
test suite at once easily triggers LLM rate limits, causing spurious failures.

E2E tests require the dev server (`pnpm dev`) to be running. If it is not known
whether the dev server is running, ask the user to start it. If the user
previously started the dev server in the session, assume it is still running. Do
not start the dev server unless asked to or after receiving explicit permission.
