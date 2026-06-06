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
 * For a deprecation window, the legacy unprefixed names are still accepted as a
 * fallback. When only a legacy name is present, a one-time warning is emitted —
 * except for `PORT` and `DATABASE_URL`, whose unprefixed names are kept as a
 * permanent canonical fallback (platform-injected `PORT`, `DATABASE_URL`
 * tooling) and therefore do not warn.
 */

/** Behaviour of a logical variable's legacy (unprefixed) name. */
export type LegacyMode = "deprecated" | "permanent";

/** A minimal, readonly view of the environment for testability. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Reads environment variables under the `DF_` prefix with a legacy fallback.
 *
 * Centralises the naming convention so every `process.env` read shares the same
 * prefix, fallback, and deprecation-warning behaviour.
 */
export class EnvReader {
    private readonly warnedKeys = new Set<string>();

    constructor(
        private readonly env: EnvSource,
        private readonly warn: (message: string) => void = () => undefined,
    ) {}

    /**
     * Read a `DF_`-prefixed variable, falling back to its legacy unprefixed
     * name. When `legacy` is `"deprecated"` and only the legacy name is set, a
     * one-time deprecation warning is emitted.
     */
    prefixed(name: string, legacy: LegacyMode = "deprecated"): string | undefined {
        const prefixedName = `DF_${name}`;
        const prefixedValue = this.env[prefixedName];
        if (prefixedValue !== undefined) {
            return prefixedValue;
        }
        const legacyValue = this.env[name];
        if (legacyValue !== undefined && legacy === "deprecated" && !this.warnedKeys.has(name)) {
            this.warnedKeys.add(name);
            this.warn(`Environment variable "${name}" is deprecated; use "${prefixedName}" instead.`);
        }
        return legacyValue;
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
        enableCompaction: boolean;
        enableCodeExecution: boolean;
        enableWebSearch: boolean;
        enableWebFetch: boolean;
        thinkingType: "adaptive" | "enabled" | undefined;
        thinkingDisplay: "summarized" | "omitted" | undefined;
        thinkingBudgetTokens: number | undefined;
        thinkingEffort: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
        maxToolIterations: number | undefined;
        debugApiContent: boolean;
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
}

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Load and validate the backend configuration from an environment source.
 *
 * @param env - The environment to read from (defaults to `process.env`).
 * @param warn - Callback invoked once per deprecated legacy variable that is in use.
 */
export function loadBackendConfig(
    env: EnvSource = process.env,
    warn: (message: string) => void = () => undefined,
): BackendConfig {
    const reader = new EnvReader(env, warn);

    const authMode = reader.prefixed("AUTH_MODE") ?? "fake";
    if (authMode !== "fake" && authMode !== "oidc") {
        throw new Error(`DF_AUTH_MODE must be "fake" or "oidc", got "${authMode}"`);
    }

    const port = parsePort(reader.prefixed("PORT", "permanent"));

    const databaseUrl = reader.prefixed("DATABASE_URL", "permanent");
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

    const modelName = reader.prefixed("ANTHROPIC_MODEL");
    if (!modelName) {
        throw new Error("DF_ANTHROPIC_MODEL environment variable is required");
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
            triageModelName: reader.prefixed("ANTHROPIC_TRIAGE_MODEL"),
            enableCompaction: reader.prefixed("ENABLE_COMPACTION") !== "false",
            enableCodeExecution: reader.prefixed("ENABLE_CODE_EXECUTION") !== "false",
            enableWebSearch: reader.prefixed("ENABLE_WEB_SEARCH") !== "false",
            enableWebFetch: reader.prefixed("ENABLE_WEB_FETCH") !== "false",
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
            maxToolIterations: parseOptionalPositiveInt(
                reader.prefixed("AGENT_MAX_TOOL_ITERATIONS"),
                "DF_AGENT_MAX_TOOL_ITERATIONS",
            ),
            debugApiContent: reader.prefixed("DEBUG_API_CONTENT") === "true",
        },
        titleModelName: reader.prefixed("ANTHROPIC_TITLE_MODEL"),
        mcp: { servers: mcpServers, toolTimeoutMs: mcpToolTimeoutMs },
        transcription,
        memberSearchStrategy,
        search,
        searchRecencyHalfLifeDays,
        trustedReverseProxy: parseTrustedReverseProxy(reader.prefixed("TRUSTED_REVERSE_PROXY")),
        adminSecret: reader.prefixed("ADMIN_SECRET"),
        adminIps: reader.prefixed("ADMIN_IPS"),
    };
}
