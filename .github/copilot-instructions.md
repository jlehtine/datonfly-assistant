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

## Linting

After code changes, run `pnpm lint:fix` and fix any linting errors caused by the
changes.

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
