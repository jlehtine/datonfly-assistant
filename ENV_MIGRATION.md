# Environment Variable Migration

Datonfly configuration now uses a single, suite-wide **`DF_` prefix** for every
variable the application owns. This document explains the new naming convention,
lists the old → new mapping for every variable, and describes how to migrate an
existing deployment.

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
hosting platforms inject them automatically. These two never emit a deprecation
warning. The prefixed name wins when both are set.

## Deprecation window for all other variables

Every other variable accepts its **legacy unprefixed name** as a fallback during
a deprecation window. When only the legacy name is set, the backend logs a
**one-time warning** on startup, for example:

```
Environment variable "AUTH_MODE" is deprecated; use "DF_AUTH_MODE" instead.
```

The prefixed `DF_` name always takes precedence when both are present. Once all
deployments have migrated, the legacy fallbacks and warnings will be removed
(the permanent `PORT` / `DATABASE_URL` fallbacks will remain).

## Variable mapping

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

### Renamed (legacy accepted during deprecation window, warns once)

| Old name                           | New name                              |
| ---------------------------------- | ------------------------------------- |
| `AUTH_MODE`                        | `DF_AUTH_MODE`                        |
| `JWT_SECRET`                       | `DF_JWT_SECRET`                       |
| `SESSION_TTL_SECONDS`              | `DF_SESSION_TTL_SECONDS`              |
| `FRONTEND_URL`                     | `DF_FRONTEND_URL`                     |
| `OIDC_ISSUER_URL`                  | `DF_OIDC_ISSUER_URL`                  |
| `OIDC_CLIENT_ID`                   | `DF_OIDC_CLIENT_ID`                   |
| `OIDC_CLIENT_SECRET`               | `DF_OIDC_CLIENT_SECRET`               |
| `OIDC_REDIRECT_URI`                | `DF_OIDC_REDIRECT_URI`                |
| `OIDC_ALLOWED_EMAIL_DOMAIN`        | `DF_OIDC_ALLOWED_EMAIL_DOMAIN`        |
| `OIDC_ALLOWED_EMAILS`              | `DF_OIDC_ALLOWED_EMAILS`              |
| `FAKE_USER_EMAIL`                  | `DF_FAKE_USER_EMAIL`                  |
| `FAKE_USER_NAME`                   | `DF_FAKE_USER_NAME`                   |
| `ANTHROPIC_MODEL`                  | `DF_ANTHROPIC_MODEL`                  |
| `ANTHROPIC_TRIAGE_MODEL`           | `DF_ANTHROPIC_TRIAGE_MODEL`           |
| `ANTHROPIC_TITLE_MODEL`            | `DF_ANTHROPIC_TITLE_MODEL`            |
| `ANTHROPIC_THINKING_TYPE`          | `DF_ANTHROPIC_THINKING_TYPE`          |
| `ANTHROPIC_THINKING_DISPLAY`       | `DF_ANTHROPIC_THINKING_DISPLAY`       |
| `ANTHROPIC_THINKING_BUDGET_TOKENS` | `DF_ANTHROPIC_THINKING_BUDGET_TOKENS` |
| `ANTHROPIC_THINKING_EFFORT`        | `DF_ANTHROPIC_THINKING_EFFORT`        |
| `ENABLE_COMPACTION`                | `DF_ENABLE_COMPACTION`                |
| `ENABLE_CODE_EXECUTION`            | `DF_ENABLE_CODE_EXECUTION`            |
| `ENABLE_WEB_SEARCH`                | `DF_ENABLE_WEB_SEARCH`                |
| `ENABLE_WEB_FETCH`                 | `DF_ENABLE_WEB_FETCH`                 |
| `AGENT_MAX_TOOL_ITERATIONS`        | `DF_AGENT_MAX_TOOL_ITERATIONS`        |
| `DEBUG_API_CONTENT`                | `DF_DEBUG_API_CONTENT`                |
| `MCP_SERVERS`                      | `DF_MCP_SERVERS`                      |
| `MCP_TOOL_TIMEOUT_MS`              | `DF_MCP_TOOL_TIMEOUT_MS`              |
| `OPENAI_TRANSCRIBE_MODEL`          | `DF_OPENAI_TRANSCRIBE_MODEL`          |
| `MEMBER_SEARCH_STRATEGY`           | `DF_MEMBER_SEARCH_STRATEGY`           |
| `QDRANT_URL`                       | `DF_QDRANT_URL`                       |
| `INFINITY_URL`                     | `DF_INFINITY_URL`                     |
| `SEARCH_STEMMER_LANGUAGE`          | `DF_SEARCH_STEMMER_LANGUAGE`          |
| `EMBEDDINGS_TIMEOUT_MS`            | `DF_EMBEDDINGS_TIMEOUT_MS`            |
| `SEARCH_RECENCY_HALF_LIFE_DAYS`    | `DF_SEARCH_RECENCY_HALF_LIFE_DAYS`    |
| `LOG_LEVEL`                        | `DF_LOG_LEVEL`                        |
| `LOG_FORMAT`                       | `DF_LOG_FORMAT`                       |
| `TRUSTED_REVERSE_PROXY`            | `DF_TRUSTED_REVERSE_PROXY`            |
| `ADMIN_SECRET`                     | `DF_ADMIN_SECRET`                     |
| `ADMIN_IPS`                        | `DF_ADMIN_IPS`                        |

> Note: the frontend's `VITE_`-prefixed build-time variables (if any are added
> in future) are owned by the Vite tooling convention and keep their `VITE_`
> prefix — do **not** apply `DF_` to them.

## How to migrate a deployment

1. **Add the new names.** Copy each configured variable to its `DF_`-prefixed
   name. The quickest approach is to rename in place; the legacy names continue
   to work during the deprecation window, so you can also add the new names
   first and remove the old ones later.
2. **Leave the two API keys alone.** Keep `ANTHROPIC_API_KEY` and
   `OPENAI_API_KEY` exactly as they are.
3. **`PORT` / `DATABASE_URL` are optional to rename.** If your platform injects
   `PORT` or `DATABASE_URL`, you may keep them — they are permanent fallbacks.
   To be explicit, set `DF_PORT` / `DF_DATABASE_URL`; the prefixed value wins.
4. **Restart and check the logs.** On startup, any remaining legacy variable
   logs a one-time deprecation warning naming its `DF_` replacement. Resolve
   each warning by switching to the new name.
5. **Remove the legacy names** once no warnings remain.

## Reference: the `.env.example`

[`.env.example`](.env.example) already uses the new `DF_` names and is the
authoritative starting point for a fresh configuration.
