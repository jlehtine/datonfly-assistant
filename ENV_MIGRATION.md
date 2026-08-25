# Environment Variable Migration

Datonfly configuration uses a single, suite-wide **`DF_` prefix** for every
variable the application owns, and vendor-neutral names for everything that
describes the agent rather than a specific provider. This document lists the old
→ new mapping for every variable and describes how to migrate an existing
deployment.

Two renames have happened, in order:

1. **Prefixing** — every application-owned variable gained the `DF_` prefix.
2. **Vendor neutrality** — the agent model variables lost their `ANTHROPIC_`
   vendor name, and the Anthropic-only server-tool toggles gained it.

Both are **hard cutovers**: the backend no longer reads any legacy name and no
deprecation warning is emitted. A deployment still using an old name silently
falls back to the default, or fails to start if the variable is required.
Operators upgrading from a pre-`DF_` deployment should follow both hops.

## Why a prefix?

A shared prefix namespaces all Datonfly configuration, avoids collisions with
unrelated variables in the environment, and makes it obvious at a glance which
variables belong to the application.

## The two canonical exceptions

Two variables keep their **canonical, unprefixed** names because the official
vendor SDKs read them directly from the environment. Do **not** add a `DF_`
prefix to these:

| Variable            | Why it is unprefixed                |
| ------------------- | ----------------------------------- |
| `ANTHROPIC_API_KEY` | Read directly by the Anthropic SDK. |
| `OPENAI_API_KEY`    | Read directly by the OpenAI SDK.    |

## Permanent fallbacks: `PORT` and `DATABASE_URL`

`DF_PORT` and `DF_DATABASE_URL` are the canonical names, but the unprefixed
`PORT` and `DATABASE_URL` are accepted as a **permanent** fallback because many
hosting platforms inject them automatically. The prefixed name wins when both
are set. These are the only two unprefixed names the backend reads.

## Hop 1 — mapping: unprefixed → `DF_`

The unprefixed names in this table are **no longer read**.

### Canonical (unchanged — never prefix)

| Variable            |
| ------------------- |
| `ANTHROPIC_API_KEY` |
| `OPENAI_API_KEY`    |

### Permanent fallback (prefer the `DF_` name; unprefixed kept forever)

| Old (still accepted) | New (canonical)   |
| -------------------- | ----------------- |
| `PORT`               | `DF_PORT`         |
| `DATABASE_URL`       | `DF_DATABASE_URL` |

### Renamed (unprefixed name no longer read)

| Old name                           | New name                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `AUTH_MODE`                        | `DF_AUTH_MODE`                                        |
| `JWT_SECRET`                       | `DF_JWT_SECRET`                                       |
| `SESSION_TTL_SECONDS`              | `DF_SESSION_TTL_SECONDS`                              |
| `FRONTEND_URL`                     | `DF_FRONTEND_URL`                                     |
| `OIDC_ISSUER_URL`                  | `DF_OIDC_ISSUER_URL`                                  |
| `OIDC_CLIENT_ID`                   | `DF_OIDC_CLIENT_ID`                                   |
| `OIDC_CLIENT_SECRET`               | `DF_OIDC_CLIENT_SECRET`                               |
| `OIDC_REDIRECT_URI`                | `DF_OIDC_REDIRECT_URI`                                |
| `OIDC_ALLOWED_EMAIL_DOMAIN`        | `DF_OIDC_ALLOWED_EMAIL_DOMAIN`                        |
| `OIDC_ALLOWED_EMAILS`              | `DF_OIDC_ALLOWED_EMAILS`                              |
| `FAKE_USER_EMAIL`                  | `DF_FAKE_USER_EMAIL`                                  |
| `FAKE_USER_NAME`                   | `DF_FAKE_USER_NAME`                                   |
| `ANTHROPIC_MODEL`                  | `DF_ANTHROPIC_MODEL` → see hop 2                      |
| `ANTHROPIC_TRIAGE_MODEL`           | `DF_ANTHROPIC_TRIAGE_MODEL` → hop 2                   |
| `ANTHROPIC_TITLE_MODEL`            | `DF_ANTHROPIC_TITLE_MODEL` → hop 2                    |
| `ANTHROPIC_THINKING_TYPE`          | `DF_ANTHROPIC_THINKING_TYPE`                          |
| `ANTHROPIC_THINKING_DISPLAY`       | `DF_ANTHROPIC_THINKING_DISPLAY`                       |
| `ANTHROPIC_THINKING_BUDGET_TOKENS` | `DF_ANTHROPIC_THINKING_BUDGET_TOKENS` (since removed) |
| `ANTHROPIC_THINKING_EFFORT`        | `DF_ANTHROPIC_THINKING_EFFORT`                        |
| `ENABLE_COMPACTION`                | `DF_ENABLE_COMPACTION` → see hop 2                    |
| `ENABLE_CODE_EXECUTION`            | `DF_ENABLE_CODE_EXECUTION` → hop 2                    |
| `ENABLE_WEB_SEARCH`                | `DF_ENABLE_WEB_SEARCH` → hop 2                        |
| `ENABLE_WEB_FETCH`                 | `DF_ENABLE_WEB_FETCH` → hop 2                         |
| `AGENT_MAX_TOOL_ITERATIONS`        | `DF_AGENT_MAX_TOOL_ITERATIONS`                        |
| `DEBUG_API_CONTENT`                | `DF_DEBUG_API_CONTENT`                                |
| `MCP_SERVERS`                      | `DF_MCP_SERVERS`                                      |
| `MCP_TOOL_TIMEOUT_MS`              | `DF_MCP_TOOL_TIMEOUT_MS`                              |
| `OPENAI_TRANSCRIBE_MODEL`          | `DF_OPENAI_TRANSCRIBE_MODEL`                          |
| `MEMBER_SEARCH_STRATEGY`           | `DF_MEMBER_SEARCH_STRATEGY`                           |
| `QDRANT_URL`                       | `DF_QDRANT_URL`                                       |
| `INFINITY_URL`                     | `DF_INFINITY_URL`                                     |
| `SEARCH_STEMMER_LANGUAGE`          | `DF_SEARCH_STEMMER_LANGUAGE`                          |
| `EMBEDDINGS_TIMEOUT_MS`            | `DF_EMBEDDINGS_TIMEOUT_MS`                            |
| `SEARCH_RECENCY_HALF_LIFE_DAYS`    | `DF_SEARCH_RECENCY_HALF_LIFE_DAYS`                    |
| `LOG_LEVEL`                        | `DF_LOG_LEVEL`                                        |
| `LOG_FORMAT`                       | `DF_LOG_FORMAT`                                       |
| `TRUSTED_REVERSE_PROXY`            | `DF_TRUSTED_REVERSE_PROXY`                            |
| `ADMIN_SECRET`                     | `DF_ADMIN_SECRET`                                     |
| `ADMIN_IPS`                        | `DF_ADMIN_IPS`                                        |

> Note: the frontend's `VITE_`-prefixed build-time variables (if any are added
> in future) are owned by the Vite tooling convention and keep their `VITE_`
> prefix — do **not** apply `DF_` to them.

## Hop 2 — mapping: vendor-neutral agent variables

The agent is selected behind a provider interface, so variables that describe
_the agent_ no longer carry a vendor name, while variables that configure a
vendor-specific capability are namespaced under that vendor. The old names are
not read; there is no fallback.

### Neutral (`DF_AGENT_*`)

| Old name                    | New name                |
| --------------------------- | ----------------------- |
| `DF_ANTHROPIC_MODEL`        | `DF_AGENT_MODEL`        |
| `DF_ANTHROPIC_TRIAGE_MODEL` | `DF_AGENT_TRIAGE_MODEL` |
| `DF_ANTHROPIC_TITLE_MODEL`  | `DF_AGENT_TITLE_MODEL`  |

`DF_AGENT_MAX_TOOL_ITERATIONS` and `DF_DEBUG_API_CONTENT` were already neutral
and are unchanged.

### Vendor-namespaced (`DF_ANTHROPIC_*`)

These toggles switch on Anthropic server-side tools with vendor-specific
semantics and versioned type identifiers, so they are namespaced rather than
neutralised — another provider's equivalents would not be interchangeable.

| Old name                   | New name                             |
| -------------------------- | ------------------------------------ |
| `DF_ENABLE_COMPACTION`     | `DF_ANTHROPIC_ENABLE_COMPACTION`     |
| `DF_ENABLE_CODE_EXECUTION` | `DF_ANTHROPIC_ENABLE_CODE_EXECUTION` |
| `DF_ENABLE_WEB_SEARCH`     | `DF_ANTHROPIC_ENABLE_WEB_SEARCH`     |
| `DF_ENABLE_WEB_FETCH`      | `DF_ANTHROPIC_ENABLE_WEB_FETCH`      |

The `DF_ANTHROPIC_THINKING_*` variables were already vendor-namespaced and are
unchanged. `ANTHROPIC_API_KEY` remains canonical and unprefixed.

## Removed variables

| Variable                              | Why it was removed                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DF_ANTHROPIC_THINKING_BUDGET_TOKENS` | Only applied to `DF_ANTHROPIC_THINKING_TYPE=enabled`, which the Claude 5 generation no longer supports. |
| `DF_SEARCH_STEMMER_LANGUAGE`          | Superseded by `DF_SEARCH_LANGUAGES` (see below).                                                        |

`DF_ANTHROPIC_THINKING_TYPE` now accepts only `adaptive`; use
`DF_ANTHROPIC_THINKING_EFFORT` to control how much the model thinks. Setting it
to `enabled` fails at startup with an explicit error rather than 400-ing on
every request.

`DF_SEARCH_STEMMER_LANGUAGE` accepted a single language and, when unset,
disabled stemming entirely (relying on Qdrant's own multilingual full-text
index). The search overhaul replaced that full-text index with a real BM25
lexical channel computed in the application, which has no per-message language
detection: `DF_SEARCH_LANGUAGES` takes a comma-separated list, and every
configured language's stemmer runs over every token unconditionally. It defaults
to `english` rather than disabling stemming, since there is always at least a
surface-form and ASCII-folded match even for an unconfigured language.

## How to migrate a deployment

1. **Rename every variable in place** using the tables above. Apply hop 1 first
   if you are coming from an unprefixed deployment, then hop 2.
2. **Leave the two API keys alone.** Keep `ANTHROPIC_API_KEY` and
   `OPENAI_API_KEY` exactly as they are.
3. **`PORT` / `DATABASE_URL` are optional to rename.** If your platform injects
   `PORT` or `DATABASE_URL`, you may keep them — they are permanent fallbacks.
   To be explicit, set `DF_PORT` / `DF_DATABASE_URL`; the prefixed value wins.
4. **Remove every legacy name.** They are no longer read, so leaving them in
   place is misleading: the application silently uses defaults instead.
5. **Restart and verify.** `DF_DATABASE_URL` (or `DATABASE_URL`) and
   `DF_AGENT_MODEL` are required; startup fails with an explicit error naming
   the missing `DF_` variable if either is absent.

## Reference: the `.env.example`

[`.env.example`](.env.example) uses the final names and is the authoritative
starting point for a fresh configuration.
