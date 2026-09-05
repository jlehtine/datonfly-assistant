# Importing production-like thread data into the dev environment

Branch: `search-topic-indexing` (support tooling for that work, kept on the same
branch rather than split out).

## Problem

Search relevance cannot be evaluated against synthetic dev data — see
[search-topic-indexing.md](search-topic-indexing.md) Phase 0.3, which needs a
baseline run over realistic threads. The test deployment has such data, but its
database also holds other people's chats, so it cannot be copied wholesale.

What is needed:

1. Export the threads of **one selected user** from a production-like database.
2. Import them into the dev database, re-attached to the dev (fake) user.
3. Clear thread history in the dev database, for one user or entirely.

Indexing is out of scope — the existing admin `reindex` endpoint rebuilds the
search index from Postgres afterwards.

## Approach

Plain SQL run through `psql`, not a Node CLI.

The server hosts only a built backend image under Docker Compose, so there is no
repo checkout and no `pnpm` there to run a workspace script with. `psql` inside
the `postgres` service is available on every deployment, and a SQL script can be
piped to it over stdin, so the export needs nothing installed on the server:

```bash
ssh SERVER 'cd <deploy-dir> && docker compose exec -T postgres \
    psql -U datonfly -d datonfly -q -v ON_ERROR_STOP=1 -v email=user@example.com' \
    < scripts/db/export-threads.sql > threads.jsonl
```

### Key decisions

- **Transport format is JSONL**, one row per line, produced by
  `COPY (SELECT json_build_object(...)) TO STDOUT` and consumed by
  `COPY … FROM STDIN` into a staging table. One JSON object per row keeps the
  whole dump a single append-only stream (multiple `COPY` statements concatenate
  on stdout), survives schema drift between the two databases, and needs no
  per-table file. Each object carries a `_t` discriminator naming its source
  table.
- **Only solo threads owned by the selected user are exported** — threads where
  that user is the `owner` and the sole `thread_member`. Any thread with a
  second member contains another real person's messages, so it is excluded
  rather than pseudonymised. The `dfa.user` row itself is never exported, so no
  real name, email or avatar leaves the server.
- **Source UUIDs are preserved; only user references are remapped.** Thread,
  message, attachment and topic ids are globally unique, so keeping them makes
  the import idempotent (`ON CONFLICT DO NOTHING`) and keeps foreign keys
  self-consistent without a mapping table. Every `user_id` / `author_id` /
  `uploader_id` in the dump belongs to the one exported user (guaranteed by the
  solo-thread rule) and is rewritten to the target dev user.
- **Staging lives in a real `dfa_import` schema, not a temp table**, because
  loading the data and transforming it happen in two separate `psql`
  invocations.
- **Import and clear are dev-only.** They are destructive against real data and
  are documented as such; only the export script is meant to touch a
  production-like database, and it is read-only.

### Data included

All thread-associated rows, in foreign-key order: `thread`, `thread_member`,
`message` (including `provider_replay_data`), `thread_user_state`, `attachment`
(bytes as hex text, round-tripped through a `bytea` cast), `thread_topic`.

## Phase 1 — Export

- [x] 1.1 Add `scripts/db/export-threads.sql`: takes `:email`, resolves it to a
      user id, collects the qualifying solo-owned thread ids into one CTE-backed
      selection, and emits the six tables as JSONL on stdout in FK order. Fail
      loudly (`ON_ERROR_STOP` plus an explicit assertion) if the email matches
      no user, rather than emitting an empty dump.
- [x] 1.2 Verify against the dev database: seed a couple of threads, export,
      inspect the JSONL by hand for completeness and for absence of `dfa.user`
      data.

## Phase 2 — Import

- [x] 2.1 Add `scripts/db/import-threads.sql`: takes `:target_email`, reads the
      staging table, inserts each table in FK order with user references
      remapped and `ON CONFLICT DO NOTHING`, and prints per-table counts.
- [x] 2.2 Add `scripts/db/import-threads.sh`, the dev-side wrapper that runs the
      three steps against the Compose `postgres` service: create/truncate
      `dfa_import`, `\copy … FROM STDIN` the dump file, run the transform, then
      drop the staging schema. Arguments: dump file, target email (defaulting to
      the first fake user, `fake.alice@dev.invalid`).
- [x] 2.3 Wire it up as a root `package.json` script (`db:import-threads`).
- [x] 2.4 Verify a round trip on the dev database: export, clear, import, and
      confirm threads, messages, attachments and topics all come back attached
      to the dev user, and that a second import of the same dump is a no-op.

## Phase 3 — Clearing thread history

- [x] 3.1 Add `scripts/db/clear-threads.sql`: with `:email` set, delete the
      threads that user owns; with `:email` empty, delete every thread. Cascades
      handle members, messages, attachments, topics and per-user state.
- [x] 3.2 Add the root `package.json` script (`db:clear-threads`), guarded so it
      is obvious it targets the local Compose database.

## Phase 4 — Documentation

- [x] 4.1 Document the export/import/clear workflow in `INSTALL.md`, including
      the reindex step (`POST /datonfly-assistant/admin/reindex`) that must
      follow an import, and a warning that the import and clear scripts are
      dev-only.
- [x] 4.2 Link this file from `search-topic-indexing.md` Phase 0.3 as the way to
      obtain the baseline corpus.

## Implementation notes

- psql does not interpolate `:'var'` inside `DO $$ ... $$` bodies (dollar-quoted
  strings are opaque to it), so the "does this user exist" checks use `\gset` +
  `\if` instead of a `DO` block.
- `\quit <code>` is not accepted by this psql version (silently warns and exits
  0 anyway). The failure path instead prints via `\warn` (stderr, so it never
  contaminates the export's stdout JSONL) and then runs a deliberately failing
  statement (`SELECT 1/0`) to get a real non-zero exit under `ON_ERROR_STOP`.
- Verified end-to-end against the local Compose Postgres with a throwaway pair
  of `test.source@dev.invalid` / `test.target@dev.invalid` users (not the fake
  users used by E2E tests): export → import → re-import (no-op, confirmed by
  0-row inserts) → scoped clear. Covered a message with embedded quotes and a
  newline, an attachment's binary bytes, and a thread topic, all round-tripping
  correctly and all user references remapped to the target. Also verified the
  "unknown email" failure path (non-zero exit, no stdout output) for both export
  and clear. Cleaned up the throwaway users afterwards.
