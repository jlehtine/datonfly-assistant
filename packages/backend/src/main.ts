import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { ServeStaticModule } from "@nestjs/serve-static";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import { Logger } from "nestjs-pino";
import pino from "pino";

import { createTitleGenerateFn, LangGraphAgent } from "@datonfly-assistant/agent-langchain";
import { McpServerSet, type McpServerConfig } from "@datonfly-assistant/agent-mcp";
import { ChatModule } from "@datonfly-assistant/chat-server";
import type { ISearchProvider, MemberSearchStrategy, ProviderLogger } from "@datonfly-assistant/core";
import { createPostgresPersistence } from "@datonfly-assistant/persistence-pg";
import { createQdrantSearch } from "@datonfly-assistant/search-qdrant";

import { AppModule } from "./app.module.js";
import { AuthModule, AuthService, type AuthConfig } from "./auth/index.js";
import { createOpenAITranscribeFn } from "./transcribe.js";

// Load .env from monorepo root (two levels up from packages/backend)
for (const candidate of [".env", "../../.env"]) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
        config({ path: abs });
        break;
    }
}

function parseTrustedReverseProxy(value: string | undefined): boolean | number | string | string[] | undefined {
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

/** Narrow an unknown value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate an optional string array field on an MCP server config entry. */
function parseStringArray(value: unknown, field: string, server: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`MCP_SERVERS: "${field}" on server "${server}" must be an array of strings`);
    }
    return value as string[];
}

/** Validate an optional string-to-string record field on an MCP server config entry. */
function parseStringRecord(value: unknown, field: string, server: string): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
        throw new Error(`MCP_SERVERS: "${field}" on server "${server}" must be an object of string values`);
    }
    return value as Record<string, string>;
}

/**
 * Parse the optional `MCP_SERVERS` environment variable into validated MCP
 * server configurations. Returns an empty array when unset or blank, so the
 * standalone backend behaves exactly as before unless MCP is configured.
 *
 * The value is a JSON array of objects, each either a stdio server
 * (`{ "name", "command", "args"?, "env"?, "cwd"? }`) or a Streamable HTTP
 * server (`{ "transport": "http", "name", "url", "headers"? }`).
 */
function parseMcpServers(value: string | undefined): McpServerConfig[] {
    const raw = value?.trim();
    if (!raw) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`MCP_SERVERS must be valid JSON: ${error instanceof Error ? error.message : "parse error"}`, {
            cause: error,
        });
    }
    if (!Array.isArray(parsed)) {
        throw new Error("MCP_SERVERS must be a JSON array of server configurations");
    }

    return parsed.map((entry, index): McpServerConfig => {
        if (!isRecord(entry)) {
            throw new Error(`MCP_SERVERS[${index.toString()}] must be an object`);
        }
        const name = entry.name;
        if (typeof name !== "string" || name.trim() === "") {
            throw new Error(`MCP_SERVERS[${index.toString()}] requires a non-empty "name"`);
        }
        const transport = entry.transport ?? "stdio";
        if (transport !== "stdio" && transport !== "http") {
            throw new Error(`MCP_SERVERS: "transport" on server "${name}" must be "stdio" or "http"`);
        }

        if (transport === "http") {
            if (typeof entry.url !== "string" || entry.url.trim() === "") {
                throw new Error(`MCP_SERVERS: HTTP server "${name}" requires a non-empty "url"`);
            }
            const headers = parseStringRecord(entry.headers, "headers", name);
            return { transport, name, url: entry.url, ...(headers ? { headers } : {}) };
        }

        if (typeof entry.command !== "string" || entry.command.trim() === "") {
            throw new Error(`MCP_SERVERS: stdio server "${name}" requires a non-empty "command"`);
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

async function bootstrap(): Promise<void> {
    const authMode = process.env.AUTH_MODE ?? "fake";
    if (authMode !== "fake" && authMode !== "oidc") {
        throw new Error(`AUTH_MODE must be "fake" or "oidc", got "${authMode}"`);
    }
    const jwtSecret = process.env.JWT_SECRET ?? randomUUID();
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
    const oidcIssuerUrl = process.env.OIDC_ISSUER_URL ?? "https://accounts.google.com";
    const secureCookie = authMode !== "fake" && !oidcIssuerUrl.startsWith("http://");

    const defaultSessionTtlSeconds = 7 * 24 * 60 * 60; // 7 days
    const sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS ?? defaultSessionTtlSeconds);
    if (!Number.isFinite(sessionTtlSeconds) || sessionTtlSeconds < 1) {
        throw new Error(
            `SESSION_TTL_SECONDS must be a positive integer, got "${String(process.env.SESSION_TTL_SECONDS)}"`,
        );
    }

    // ─── Persistence ───
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL environment variable is required");
    }

    const pg = await createPostgresPersistence({ connectionString: databaseUrl });
    const persistence = pg.provider;
    const destroyPersistence = pg.destroy;

    const allowedEmailDomain = process.env.OIDC_ALLOWED_EMAIL_DOMAIN;
    const allowedEmails = process.env.OIDC_ALLOWED_EMAILS
        ? process.env.OIDC_ALLOWED_EMAILS.split(",")
              .map((e) => e.trim())
              .filter(Boolean)
        : undefined;

    if (authMode === "oidc") {
        if (!process.env.OIDC_CLIENT_ID) {
            throw new Error("OIDC_CLIENT_ID is required when AUTH_MODE=oidc");
        }
        if (!process.env.OIDC_CLIENT_SECRET) {
            throw new Error("OIDC_CLIENT_SECRET is required when AUTH_MODE=oidc");
        }
    }

    const authConfig: AuthConfig = {
        mode: authMode,
        jwtSecret,
        frontendUrl,
        secureCookie,
        sessionTtlMs: sessionTtlSeconds * 1000,
        allowedEmailDomain,
        allowedEmails,
        oidc:
            authMode === "oidc"
                ? {
                      issuerUrl: oidcIssuerUrl,
                      clientId: process.env.OIDC_CLIENT_ID ?? "",
                      clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
                      redirectUri:
                          process.env.OIDC_REDIRECT_URI ??
                          `http://localhost:${process.env.PORT ?? "3000"}/auth/callback`,
                  }
                : undefined,
        fakeUser:
            authMode === "fake"
                ? {
                      email: process.env.FAKE_USER_EMAIL ?? "dev@localhost",
                      name: process.env.FAKE_USER_NAME ?? "Dev User",
                  }
                : undefined,
    };

    const authService = new AuthService(authConfig);
    await authService.initialize();

    const model = process.env.ANTHROPIC_MODEL;
    if (!model) {
        throw new Error("ANTHROPIC_MODEL environment variable is required");
    }

    const rawThinkingType = process.env.ANTHROPIC_THINKING_TYPE;
    if (rawThinkingType && rawThinkingType !== "adaptive" && rawThinkingType !== "enabled") {
        throw new Error(`ANTHROPIC_THINKING_TYPE must be "adaptive" or "enabled", got "${rawThinkingType}"`);
    }
    const thinkingType = rawThinkingType as "adaptive" | "enabled" | undefined;

    const rawThinkingDisplay = process.env.ANTHROPIC_THINKING_DISPLAY;
    if (rawThinkingDisplay && rawThinkingDisplay !== "summarized" && rawThinkingDisplay !== "omitted") {
        throw new Error(`ANTHROPIC_THINKING_DISPLAY must be "summarized" or "omitted", got "${rawThinkingDisplay}"`);
    }
    const thinkingDisplay = rawThinkingDisplay as "summarized" | "omitted" | undefined;

    const rawThinkingBudget = process.env.ANTHROPIC_THINKING_BUDGET_TOKENS;
    const thinkingBudgetTokens = rawThinkingBudget !== undefined ? Number(rawThinkingBudget) : undefined;
    if (
        rawThinkingBudget !== undefined &&
        (!Number.isFinite(thinkingBudgetTokens) || (thinkingBudgetTokens ?? 0) <= 0)
    ) {
        throw new Error(`ANTHROPIC_THINKING_BUDGET_TOKENS must be a positive number, got "${rawThinkingBudget}"`);
    }

    const rawThinkingEffort = process.env.ANTHROPIC_THINKING_EFFORT;
    if (rawThinkingEffort && !["low", "medium", "high", "xhigh", "max"].includes(rawThinkingEffort)) {
        throw new Error(
            `ANTHROPIC_THINKING_EFFORT must be one of low|medium|high|xhigh|max, got "${rawThinkingEffort}"`,
        );
    }
    const thinkingEffort = rawThinkingEffort as "low" | "medium" | "high" | "xhigh" | "max" | undefined;

    const agentLogger: ProviderLogger = pino({
        level: process.env.LOG_LEVEL ?? "info",
        ...(process.env.LOG_FORMAT === "json"
            ? {}
            : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
        redact: {
            paths: ["email", "name", "content", "text", "*.email", "*.name", "*.content", "*.text"],
            censor: "[REDACTED]",
        },
    }).child({ component: "assistant-api" });

    // Optional: external MCP servers whose tools are exposed to the agent on
    // every call. Disabled (no behaviour change) unless MCP_SERVERS is set.
    const mcpConfigs = parseMcpServers(process.env.MCP_SERVERS);
    const rawMcpTimeout = process.env.MCP_TOOL_TIMEOUT_MS;
    const mcpToolTimeoutMs = rawMcpTimeout !== undefined ? Number(rawMcpTimeout) : undefined;
    if (rawMcpTimeout !== undefined && (!Number.isFinite(mcpToolTimeoutMs) || (mcpToolTimeoutMs ?? 0) <= 0)) {
        throw new Error(`MCP_TOOL_TIMEOUT_MS must be a positive number, got "${rawMcpTimeout}"`);
    }
    let mcpServerSet: McpServerSet | undefined;
    if (mcpConfigs.length > 0) {
        mcpServerSet = await McpServerSet.connect(mcpConfigs, {
            clientName: "datonfly-assistant",
            ...(mcpToolTimeoutMs !== undefined ? { callTimeoutMs: mcpToolTimeoutMs } : {}),
        });
        agentLogger.info({ servers: mcpConfigs.length, tools: mcpServerSet.tools.length }, "Connected to MCP servers");
    }

    const rawMaxToolIterations = process.env.AGENT_MAX_TOOL_ITERATIONS;
    const maxToolIterations = rawMaxToolIterations !== undefined ? Number(rawMaxToolIterations) : undefined;
    if (rawMaxToolIterations !== undefined && (!Number.isInteger(maxToolIterations) || (maxToolIterations ?? 0) < 1)) {
        throw new Error(`AGENT_MAX_TOOL_ITERATIONS must be a positive integer, got "${rawMaxToolIterations}"`);
    }

    const agent = new LangGraphAgent({
        modelName: model,
        apiKey: process.env.ANTHROPIC_API_KEY,
        triageModelName: process.env.ANTHROPIC_TRIAGE_MODEL,
        enableCompaction: process.env.ENABLE_COMPACTION !== "false",
        enableCodeExecution: process.env.ENABLE_CODE_EXECUTION !== "false",
        enableWebSearch: process.env.ENABLE_WEB_SEARCH !== "false",
        enableWebFetch: process.env.ENABLE_WEB_FETCH !== "false",
        thinkingType,
        thinkingDisplay,
        thinkingBudgetTokens,
        thinkingEffort,
        ...(maxToolIterations !== undefined ? { maxToolIterations } : {}),
        ...(mcpServerSet ? { defaultTools: mcpServerSet.tools } : {}),
        logger: agentLogger,
    });

    // Optional: separate (cheaper) model for automatic thread title generation.
    const titleModelName = process.env.ANTHROPIC_TITLE_MODEL;
    const generateTitle = titleModelName
        ? createTitleGenerateFn({
              modelName: titleModelName,
              apiKey: process.env.ANTHROPIC_API_KEY,
          })
        : undefined;

    // Optional: audio input transcription backed by OpenAI. Enabled when an API
    // key is present; advertised to clients via the welcome event feature flag.
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const transcribe = openaiApiKey
        ? createOpenAITranscribeFn({
              apiKey: openaiApiKey,
              model: process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
          })
        : undefined;

    const rawStrategy = process.env.MEMBER_SEARCH_STRATEGY ?? "default";
    if (rawStrategy !== "default" && rawStrategy !== "limited-visibility") {
        throw new Error(`MEMBER_SEARCH_STRATEGY must be "default" or "limited-visibility", got "${rawStrategy}"`);
    }
    const memberSearchStrategy: MemberSearchStrategy = rawStrategy;

    // Optional: semantic search backed by Qdrant + infinity-emb.
    let searchProvider: ISearchProvider | undefined;
    const qdrantUrl = process.env.QDRANT_URL;
    if (qdrantUrl) {
        const infinityUrl = process.env.INFINITY_URL ?? "http://localhost:8080";
        const stemmerLanguage = process.env.SEARCH_STEMMER_LANGUAGE ?? undefined;
        const rawEmbeddingsTimeout = process.env.EMBEDDINGS_TIMEOUT_MS;
        const embeddingsTimeoutMs = rawEmbeddingsTimeout !== undefined ? Number(rawEmbeddingsTimeout) : undefined;
        const searchLogger = agentLogger.child({ component: "search" });
        const { searchProvider: sp } = createQdrantSearch({
            qdrantUrl,
            infinityUrl,
            stemmerLanguage,
            embeddingsTimeoutMs,
            logger: searchLogger,
        });
        searchProvider = sp;
    }

    const chatModule = ChatModule.forRoot({
        agent,
        persistence,
        validateToken: (token: string) => authService.authenticateToken(token),
        generateTitle,
        transcribe,
        cors: { origin: frontendUrl, credentials: true },
        memberSearchStrategy,
        search: searchProvider,
        searchRecencyHalfLifeDays: process.env.SEARCH_RECENCY_HALF_LIFE_DAYS
            ? Number(process.env.SEARCH_RECENCY_HALF_LIFE_DAYS)
            : undefined,
        trustedReverseProxy: parseTrustedReverseProxy(process.env.TRUSTED_REVERSE_PROXY),
        adminSecret: process.env.ADMIN_SECRET ?? undefined,
        adminIps: process.env.ADMIN_IPS ?? undefined,
    });

    const extraModules = [chatModule];

    const publicDir = resolve("public");
    if (existsSync(publicDir)) {
        extraModules.push(
            ServeStaticModule.forRoot({
                rootPath: publicDir,
            }),
        );
    }

    const app = await NestFactory.create(AppModule.register(AuthModule.create(authService), extraModules), {
        bufferLogs: true,
    });
    app.useLogger(app.get(Logger));
    app.use(cookieParser());

    const trustedReverseProxy = parseTrustedReverseProxy(process.env.TRUSTED_REVERSE_PROXY);
    const httpApp = app.getHttpAdapter().getInstance() as {
        set?: ((name: string, value: unknown) => void) | undefined;
    };
    httpApp.set?.("trust proxy", trustedReverseProxy ?? false);

    app.enableCors({
        origin: frontendUrl,
        credentials: true,
    });

    const port = process.env.PORT ?? "3000";
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        throw new Error(`PORT must be an integer between 1 and 65535, got "${port}"`);
    }
    await app.listen(port);

    const logger = app.get(Logger);
    logger.log(`Backend listening on port ${port}`);

    // ─── Process-level safety nets ───
    process.on("unhandledRejection", (reason: unknown) => {
        logger.error(reason, "Unhandled promise rejection");
    });
    process.on("uncaughtException", (err: Error) => {
        logger.error(err, "Uncaught exception");
    });

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
        logger.log("Shutting down...");
        await app.close();
        if (mcpServerSet) {
            await mcpServerSet.close();
        }
        await destroyPersistence();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
}

void bootstrap();
