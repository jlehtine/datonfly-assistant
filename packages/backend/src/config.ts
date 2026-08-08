import { randomUUID } from "node:crypto";

import type { McpServerConfig } from "@datonfly-assistant/agent-mcp";
import type { MemberSearchStrategy } from "@datonfly-assistant/core";

import type { AuthConfig } from "./auth/index.js";

/**
 * Environment variable naming convention.
 *
 * All Datonfly-owned configuration uses a single suite-wide `DF_` prefix. Two
 * exceptions keep their canonical names because the official SDKs read them
 * directly from the environment: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
 *
 * `PORT` and `DATABASE_URL` additionally accept their unprefixed names as a
 * permanent fallback, because hosting platforms and database tooling inject
 * them that way. No other unprefixed name is read.
 */

/** A minimal, readonly view of the environment for testability. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Reads environment variables under the `DF_` prefix.
 *
 * Centralises the naming convention so every `process.env` read shares the same
 * prefix and the two documented exceptions stay explicit at the call site.
 */
export class EnvReader {
    constructor(private readonly env: EnvSource) {}

    /** Read a `DF_`-prefixed variable. */
    prefixed(name: string): string | undefined {
        return this.env[`DF_${name}`];
    }

    /**
     * Read a `DF_`-prefixed variable, falling back to its unprefixed canonical
     * name. Reserved for `PORT` and `DATABASE_URL`, which hosting platforms
     * inject unprefixed.
     */
    prefixedWithCanonicalFallback(name: string): string | undefined {
        return this.env[`DF_${name}`] ?? this.env[name];
    }

    /** Read a canonical (never-prefixed) variable, such as an SDK-read API key. */
    canonical(name: string): string | undefined {
        return this.env[name];
    }
}

/** Narrow an unknown value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and validate the `DF_PORT` value, returning a port number. */
export function parsePort(raw: string | undefined): number {
    const value = raw ?? "3000";
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`DF_PORT must be an integer between 1 and 65535, got "${value}"`);
    }
    return port;
}

/** Parse a required positive integer, throwing with the variable name on failure. */
function parsePositiveInt(raw: string | undefined, varName: string, fallback: number): number {
    if (raw === undefined) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) {
        throw new Error(`${varName} must be a positive integer, got "${raw}"`);
    }
    return value;
}

/** Parse an optional positive number, throwing with the variable name on failure. */
function parsePositiveNumber(raw: string | undefined, varName: string): number | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${varName} must be a positive number, got "${raw}"`);
    }
    return value;
}

/** Parse an optional positive integer, throwing with the variable name on failure. */
function parseOptionalPositiveInt(raw: string | undefined, varName: string): number | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${varName} must be a positive integer, got "${raw}"`);
    }
    return value;
}

/** Validate an optional value against an allowed set, throwing with the variable name on failure. */
function parseEnum<T extends string>(raw: string | undefined, allowed: readonly T[], varName: string): T | undefined {
    if (raw === undefined || raw === "") {
        return undefined;
    }
    if (!(allowed as readonly string[]).includes(raw)) {
        throw new Error(`${varName} must be one of ${allowed.join("|")}, got "${raw}"`);
    }
    return raw as T;
}

/** Parse the Express `trust proxy` setting from its raw string form. */
export function parseTrustedReverseProxy(value: string | undefined): boolean | number | string | string[] | undefined {
    const raw = value?.trim();
    if (!raw) {
        return undefined;
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^\d+$/.test(raw)) return Number(raw);

    const addresses = raw
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter(Boolean);

    return addresses.length > 1 ? addresses : raw;
}

/** Validate an optional string-array field on an MCP server config entry. */
function parseStringArray(value: unknown, field: string, server: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`DF_MCP_SERVERS: "${field}" on server "${server}" must be an array of strings`);
    }
    return value as string[];
}

/** Validate an optional string-to-string record field on an MCP server config entry. */
function parseStringRecord(value: unknown, field: string, server: string): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
        throw new Error(`DF_MCP_SERVERS: "${field}" on server "${server}" must be an object of string values`);
    }
    return value as Record<string, string>;
}

/**
 * Parse the optional `DF_MCP_SERVERS` value into validated MCP server
 * configurations. Returns an empty array when unset or blank.
 *
 * The value is a JSON array of objects, each either a stdio server
 * (`{ "name", "command", "args"?, "env"?, "cwd"? }`) or a Streamable HTTP
 * server (`{ "transport": "http", "name", "url", "headers"? }`).
 */
export function parseMcpServers(value: string | undefined): McpServerConfig[] {
    const raw = value?.trim();
    if (!raw) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `DF_MCP_SERVERS must be valid JSON: ${error instanceof Error ? error.message : "parse error"}`,
            {
                cause: error,
            },
        );
    }
    if (!Array.isArray(parsed)) {
        throw new Error("DF_MCP_SERVERS must be a JSON array of server configurations");
    }

    return parsed.map((entry, index): McpServerConfig => {
        if (!isRecord(entry)) {
            throw new Error(`DF_MCP_SERVERS[${index.toString()}] must be an object`);
        }
        const name = entry.name;
        if (typeof name !== "string" || name.trim() === "") {
            throw new Error(`DF_MCP_SERVERS[${index.toString()}] requires a non-empty "name"`);
        }
        const transport = entry.transport ?? "stdio";
        if (transport !== "stdio" && transport !== "http") {
            throw new Error(`DF_MCP_SERVERS: "transport" on server "${name}" must be "stdio" or "http"`);
        }

        if (transport === "http") {
            if (typeof entry.url !== "string" || entry.url.trim() === "") {
                throw new Error(`DF_MCP_SERVERS: HTTP server "${name}" requires a non-empty "url"`);
            }
            const headers = parseStringRecord(entry.headers, "headers", name);
            return { transport, name, url: entry.url, ...(headers ? { headers } : {}) };
        }

        if (typeof entry.command !== "string" || entry.command.trim() === "") {
            throw new Error(`DF_MCP_SERVERS: stdio server "${name}" requires a non-empty "command"`);
        }
        const args = parseStringArray(entry.args, "args", name);
        const env = parseStringRecord(entry.env, "env", name);
        const cwd = typeof entry.cwd === "string" ? entry.cwd : undefined;
        return {
            transport,
            name,
            command: entry.command,
            ...(args ? { args } : {}),
            ...(env ? { env } : {}),
            ...(cwd !== undefined ? { cwd } : {}),
        };
    });
}

/** Fully parsed and validated backend configuration. */
export interface BackendConfig {
    port: number;
    databaseUrl: string;
    frontendUrl: string;
    auth: AuthConfig;
    log: { level: string; format: "json" | "pretty" };
    /** Anthropic API key (canonical `ANTHROPIC_API_KEY`); shared by chat and title models. */
    anthropicApiKey: string | undefined;
    agent: {
        modelName: string;
        triageModelName: string | undefined;
        maxToolIterations: number | undefined;
        debugApiContent: boolean;
        /** Anthropic-only knobs, grouped so they map onto provider options. */
        anthropic: {
            enableCompaction: boolean;
            enableCodeExecution: boolean;
            enableWebSearch: boolean;
            enableWebFetch: boolean;
            thinkingType: "adaptive" | "enabled" | undefined;
            thinkingDisplay: "summarized" | "omitted" | undefined;
            thinkingBudgetTokens: number | undefined;
            thinkingEffort: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
        };
    };
    titleModelName: string | undefined;
    mcp: { servers: McpServerConfig[]; toolTimeoutMs: number | undefined };
    transcription: { apiKey: string; model: string } | undefined;
    memberSearchStrategy: MemberSearchStrategy;
    search:
        | {
              qdrantUrl: string;
              infinityUrl: string;
              stemmerLanguage: string | undefined;
              embeddingsTimeoutMs: number | undefined;
          }
        | undefined;
    searchRecencyHalfLifeDays: number | undefined;
    trustedReverseProxy: boolean | number | string | string[] | undefined;
    adminSecret: string | undefined;
    adminIps: string | undefined;
    rateLimit: {
        enabled: boolean;
        factor: number | undefined;
        expectedUsers: number | undefined;
    };
}

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Load and validate the backend configuration from an environment source.
 *
 * @param env - The environment to read from (defaults to `process.env`).
 */
export function loadBackendConfig(env: EnvSource = process.env): BackendConfig {
    const reader = new EnvReader(env);

    const authMode = reader.prefixed("AUTH_MODE") ?? "fake";
    if (authMode !== "fake" && authMode !== "oidc") {
        throw new Error(`DF_AUTH_MODE must be "fake" or "oidc", got "${authMode}"`);
    }

    const port = parsePort(reader.prefixedWithCanonicalFallback("PORT"));

    const databaseUrl = reader.prefixedWithCanonicalFallback("DATABASE_URL");
    if (!databaseUrl) {
        throw new Error("DF_DATABASE_URL environment variable is required");
    }

    const frontendUrl = reader.prefixed("FRONTEND_URL") ?? "http://localhost:5173";
    const oidcIssuerUrl = reader.prefixed("OIDC_ISSUER_URL") ?? "https://accounts.google.com";
    const secureCookie = authMode !== "fake" && !oidcIssuerUrl.startsWith("http://");

    const sessionTtlSeconds = parsePositiveInt(
        reader.prefixed("SESSION_TTL_SECONDS"),
        "DF_SESSION_TTL_SECONDS",
        DEFAULT_SESSION_TTL_SECONDS,
    );

    const allowedEmailDomain = reader.prefixed("OIDC_ALLOWED_EMAIL_DOMAIN");
    const rawAllowedEmails = reader.prefixed("OIDC_ALLOWED_EMAILS");
    const allowedEmails = rawAllowedEmails
        ? rawAllowedEmails
              .split(",")
              .map((e) => e.trim())
              .filter(Boolean)
        : undefined;

    const oidcClientId = reader.prefixed("OIDC_CLIENT_ID");
    const oidcClientSecret = reader.prefixed("OIDC_CLIENT_SECRET");
    if (authMode === "oidc") {
        if (!oidcClientId) {
            throw new Error("DF_OIDC_CLIENT_ID is required when DF_AUTH_MODE=oidc");
        }
        if (!oidcClientSecret) {
            throw new Error("DF_OIDC_CLIENT_SECRET is required when DF_AUTH_MODE=oidc");
        }
    }

    const auth: AuthConfig = {
        mode: authMode,
        jwtSecret: reader.prefixed("JWT_SECRET") ?? randomUUID(),
        frontendUrl,
        secureCookie,
        sessionTtlMs: sessionTtlSeconds * 1000,
        allowedEmailDomain,
        allowedEmails,
        oidc:
            authMode === "oidc"
                ? {
                      issuerUrl: oidcIssuerUrl,
                      clientId: oidcClientId ?? "",
                      clientSecret: oidcClientSecret ?? "",
                      redirectUri:
                          reader.prefixed("OIDC_REDIRECT_URI") ?? `http://localhost:${port.toString()}/auth/callback`,
                  }
                : undefined,
        fakeUser:
            authMode === "fake"
                ? {
                      email: reader.prefixed("FAKE_USER_EMAIL") ?? "dev@localhost",
                      name: reader.prefixed("FAKE_USER_NAME") ?? "Dev User",
                  }
                : undefined,
    };

    const modelName = reader.prefixed("AGENT_MODEL");
    if (!modelName) {
        throw new Error("DF_AGENT_MODEL environment variable is required");
    }

    const anthropicApiKey = reader.canonical("ANTHROPIC_API_KEY");

    const logFormat = reader.prefixed("LOG_FORMAT") === "json" ? "json" : "pretty";

    const mcpServers = parseMcpServers(reader.prefixed("MCP_SERVERS"));
    const mcpToolTimeoutMs = parsePositiveNumber(reader.prefixed("MCP_TOOL_TIMEOUT_MS"), "DF_MCP_TOOL_TIMEOUT_MS");

    const openaiApiKey = reader.canonical("OPENAI_API_KEY");
    const transcription = openaiApiKey
        ? {
              apiKey: openaiApiKey,
              model: reader.prefixed("OPENAI_TRANSCRIBE_MODEL") ?? "gpt-4o-mini-transcribe",
          }
        : undefined;

    const memberSearchStrategy =
        parseEnum(
            reader.prefixed("MEMBER_SEARCH_STRATEGY"),
            ["default", "limited-visibility"] as const,
            "DF_MEMBER_SEARCH_STRATEGY",
        ) ?? "default";

    const qdrantUrl = reader.prefixed("QDRANT_URL");
    const search = qdrantUrl
        ? {
              qdrantUrl,
              infinityUrl: reader.prefixed("INFINITY_URL") ?? "http://localhost:8080",
              stemmerLanguage: reader.prefixed("SEARCH_STEMMER_LANGUAGE"),
              embeddingsTimeoutMs: parsePositiveNumber(
                  reader.prefixed("EMBEDDINGS_TIMEOUT_MS"),
                  "DF_EMBEDDINGS_TIMEOUT_MS",
              ),
          }
        : undefined;

    const searchRecencyHalfLifeDays = parsePositiveNumber(
        reader.prefixed("SEARCH_RECENCY_HALF_LIFE_DAYS"),
        "DF_SEARCH_RECENCY_HALF_LIFE_DAYS",
    );

    return {
        port,
        databaseUrl,
        frontendUrl,
        auth,
        log: { level: reader.prefixed("LOG_LEVEL") ?? "info", format: logFormat },
        anthropicApiKey,
        agent: {
            modelName,
            triageModelName: reader.prefixed("AGENT_TRIAGE_MODEL"),
            maxToolIterations: parseOptionalPositiveInt(
                reader.prefixed("AGENT_MAX_TOOL_ITERATIONS"),
                "DF_AGENT_MAX_TOOL_ITERATIONS",
            ),
            debugApiContent: reader.prefixed("DEBUG_API_CONTENT") === "true",
            anthropic: {
                enableCompaction: reader.prefixed("ANTHROPIC_ENABLE_COMPACTION") !== "false",
                enableCodeExecution: reader.prefixed("ANTHROPIC_ENABLE_CODE_EXECUTION") !== "false",
                enableWebSearch: reader.prefixed("ANTHROPIC_ENABLE_WEB_SEARCH") !== "false",
                enableWebFetch: reader.prefixed("ANTHROPIC_ENABLE_WEB_FETCH") !== "false",
                thinkingType: parseEnum(
                    reader.prefixed("ANTHROPIC_THINKING_TYPE"),
                    ["adaptive", "enabled"] as const,
                    "DF_ANTHROPIC_THINKING_TYPE",
                ),
                thinkingDisplay: parseEnum(
                    reader.prefixed("ANTHROPIC_THINKING_DISPLAY"),
                    ["summarized", "omitted"] as const,
                    "DF_ANTHROPIC_THINKING_DISPLAY",
                ),
                thinkingBudgetTokens: parsePositiveNumber(
                    reader.prefixed("ANTHROPIC_THINKING_BUDGET_TOKENS"),
                    "DF_ANTHROPIC_THINKING_BUDGET_TOKENS",
                ),
                thinkingEffort: parseEnum(
                    reader.prefixed("ANTHROPIC_THINKING_EFFORT"),
                    ["low", "medium", "high", "xhigh", "max"] as const,
                    "DF_ANTHROPIC_THINKING_EFFORT",
                ),
            },
        },
        titleModelName: reader.prefixed("AGENT_TITLE_MODEL"),
        mcp: { servers: mcpServers, toolTimeoutMs: mcpToolTimeoutMs },
        transcription,
        memberSearchStrategy,
        search,
        searchRecencyHalfLifeDays,
        trustedReverseProxy: parseTrustedReverseProxy(reader.prefixed("TRUSTED_REVERSE_PROXY")),
        adminSecret: reader.prefixed("ADMIN_SECRET"),
        adminIps: reader.prefixed("ADMIN_IPS"),
        rateLimit: {
            enabled: reader.prefixed("RATE_LIMIT_ENABLED") !== "false",
            factor: parsePositiveNumber(reader.prefixed("RATE_LIMIT_FACTOR"), "DF_RATE_LIMIT_FACTOR"),
            expectedUsers: parseOptionalPositiveInt(
                reader.prefixed("RATE_LIMIT_EXPECTED_USERS"),
                "DF_RATE_LIMIT_EXPECTED_USERS",
            ),
        },
    };
}
