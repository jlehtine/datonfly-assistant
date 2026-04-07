import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { ServeStaticModule } from "@nestjs/serve-static";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import { Logger } from "nestjs-pino";

import { createTitleGenerateFn, LangGraphAgent } from "@datonfly-assistant/agent-langchain";
import { ChatModule } from "@datonfly-assistant/chat-server";
import { createPostgresPersistence } from "@datonfly-assistant/persistence-pg";

import { AppModule } from "./app.module.js";
import { AuthModule, AuthService, type AuthConfig } from "./auth/index.js";

// Load .env from monorepo root (two levels up from packages/backend)
for (const candidate of [".env", "../../.env"]) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
        config({ path: abs });
        break;
    }
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

    const agent = new LangGraphAgent({
        modelName: model,
        apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Optional: separate (cheaper) model for automatic thread title generation.
    const titleModelName = process.env.ANTHROPIC_TITLE_MODEL;
    const generateTitle = titleModelName
        ? createTitleGenerateFn({
              modelName: titleModelName,
              apiKey: process.env.ANTHROPIC_API_KEY,
          })
        : undefined;

    const chatModule = ChatModule.forRoot({
        agent,
        persistence,
        validateToken: (token: string) => authService.authenticateToken(token),
        generateTitle,
        cors: { origin: frontendUrl, credentials: true },
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

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
        logger.log("Shutting down...");
        await app.close();
        await destroyPersistence();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
}

void bootstrap();
