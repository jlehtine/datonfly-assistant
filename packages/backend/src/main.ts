import "reflect-metadata";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { ServeStaticModule } from "@nestjs/serve-static";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import { Logger } from "nestjs-pino";
import pino from "pino";

import { AnthropicAgent, createTitleGenerateFn } from "@datonfly-assistant/agent-langchain";
import { McpServerSet } from "@datonfly-assistant/agent-mcp";
import { ChatModule } from "@datonfly-assistant/chat-server";
import type { ISearchProvider, ProviderLogger } from "@datonfly-assistant/core";
import { createPostgresPersistence } from "@datonfly-assistant/persistence-pg";
import { createQdrantSearch } from "@datonfly-assistant/search-qdrant";

import { AppModule } from "./app.module.js";
import { AuthModule, AuthService } from "./auth/index.js";
import { loadBackendConfig } from "./config.js";
import { createOpenAITranscribeFn } from "./transcribe.js";

// Load .env from monorepo root (two levels up from packages/backend)
for (const candidate of [".env", "../../.env"]) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
        config({ path: abs });
        break;
    }
}

async function bootstrap(): Promise<void> {
    const deprecationWarnings: string[] = [];
    const cfg = loadBackendConfig(process.env, (message) => deprecationWarnings.push(message));

    // ─── Persistence ───
    const pg = await createPostgresPersistence({ connectionString: cfg.databaseUrl });
    const persistence = pg.provider;
    const destroyPersistence = pg.destroy;

    const authService = new AuthService(cfg.auth);
    await authService.initialize();

    const agentLogger: ProviderLogger = pino({
        level: cfg.log.level,
        ...(cfg.log.format === "json" ? {} : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
        redact: {
            paths: ["email", "name", "content", "text", "*.email", "*.name", "*.content", "*.text"],
            censor: "[REDACTED]",
        },
    }).child({ component: "assistant-api" });

    for (const message of deprecationWarnings) {
        agentLogger.warn({}, message);
    }

    // Optional: external MCP servers whose tools are exposed to the agent on
    // every call. Disabled (no behaviour change) unless DF_MCP_SERVERS is set.
    let mcpServerSet: McpServerSet | undefined;
    if (cfg.mcp.servers.length > 0) {
        mcpServerSet = await McpServerSet.connect(cfg.mcp.servers, {
            clientName: "datonfly-assistant",
            ...(cfg.mcp.toolTimeoutMs !== undefined ? { callTimeoutMs: cfg.mcp.toolTimeoutMs } : {}),
        });
        agentLogger.info(
            { servers: cfg.mcp.servers.length, tools: mcpServerSet.tools.length },
            "Connected to MCP servers",
        );
    }

    const agent = new AnthropicAgent({
        modelName: cfg.agent.modelName,
        apiKey: cfg.anthropicApiKey,
        triageModelName: cfg.agent.triageModelName,
        enableCompaction: cfg.agent.enableCompaction,
        enableCodeExecution: cfg.agent.enableCodeExecution,
        enableWebSearch: cfg.agent.enableWebSearch,
        enableWebFetch: cfg.agent.enableWebFetch,
        thinkingType: cfg.agent.thinkingType,
        thinkingDisplay: cfg.agent.thinkingDisplay,
        thinkingBudgetTokens: cfg.agent.thinkingBudgetTokens,
        thinkingEffort: cfg.agent.thinkingEffort,
        debugApiContent: cfg.agent.debugApiContent,
        ...(cfg.agent.maxToolIterations !== undefined ? { maxToolIterations: cfg.agent.maxToolIterations } : {}),
        ...(mcpServerSet ? { defaultTools: mcpServerSet.tools } : {}),
        logger: agentLogger,
    });

    // Optional: separate (cheaper) model for automatic thread title generation.
    const generateTitle = cfg.titleModelName
        ? createTitleGenerateFn({
              modelName: cfg.titleModelName,
              apiKey: cfg.anthropicApiKey,
          })
        : undefined;

    // Optional: audio input transcription backed by OpenAI. Enabled when an API
    // key is present; advertised to clients via the welcome event feature flag.
    const transcribe = cfg.transcription
        ? createOpenAITranscribeFn({
              apiKey: cfg.transcription.apiKey,
              model: cfg.transcription.model,
          })
        : undefined;

    // Optional: semantic search backed by Qdrant + infinity-emb.
    let searchProvider: ISearchProvider | undefined;
    if (cfg.search) {
        const searchLogger = agentLogger.child({ component: "search" });
        const { searchProvider: sp } = createQdrantSearch({
            qdrantUrl: cfg.search.qdrantUrl,
            infinityUrl: cfg.search.infinityUrl,
            stemmerLanguage: cfg.search.stemmerLanguage,
            embeddingsTimeoutMs: cfg.search.embeddingsTimeoutMs,
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
        cors: { origin: cfg.frontendUrl, credentials: true },
        memberSearchStrategy: cfg.memberSearchStrategy,
        search: searchProvider,
        searchRecencyHalfLifeDays: cfg.searchRecencyHalfLifeDays,
        trustedReverseProxy: cfg.trustedReverseProxy,
        adminSecret: cfg.adminSecret,
        adminIps: cfg.adminIps,
        logLevel: cfg.log.level,
        logFormat: cfg.log.format,
        rateLimit: {
            enabled: cfg.rateLimit.enabled,
            factor: cfg.rateLimit.factor,
            expectedUsers: cfg.rateLimit.expectedUsers,
        },
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

    const httpApp = app.getHttpAdapter().getInstance() as {
        set?: ((name: string, value: unknown) => void) | undefined;
    };
    httpApp.set?.("trust proxy", cfg.trustedReverseProxy ?? false);

    app.enableCors({
        origin: cfg.frontendUrl,
        credentials: true,
    });

    await app.listen(cfg.port);

    const logger = app.get(Logger);
    logger.log(`Backend listening on port ${cfg.port.toString()}`);

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
