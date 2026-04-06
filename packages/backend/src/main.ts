import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";

import { createTitleGenerateFn, LangGraphAgent } from "@datonfly-assistant/agent-langchain";
import { ChatRealtimeServer } from "@datonfly-assistant/chat-server";
import { createPostgresPersistence } from "@datonfly-assistant/persistence-pg";

import { AppModule } from "./app.module.js";
import { AuthModule, AuthService, type AuthConfig } from "./auth/index.js";
import { ThreadModule } from "./thread/thread.module.js";

// Load .env from monorepo root (two levels up from packages/backend)
for (const candidate of [".env", "../../.env"]) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
        config({ path: abs });
        break;
    }
}

async function bootstrap(): Promise<void> {
    const authMode = (process.env.AUTH_MODE ?? "fake") as "fake" | "oidc";
    const jwtSecret = process.env.JWT_SECRET ?? randomUUID();
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

    // ─── Persistence ───
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL environment variable is required");
    }

    const pg = await createPostgresPersistence({ connectionString: databaseUrl });
    const persistence = pg.provider;
    const destroyPersistence = pg.destroy;
    console.log("PostgreSQL persistence initialized");

    const allowedEmailDomain = process.env.OIDC_ALLOWED_EMAIL_DOMAIN;

    const authConfig: AuthConfig = {
        mode: authMode,
        jwtSecret,
        frontendUrl,
        persistence,
        allowedEmailDomain,
        oidc:
            authMode === "oidc"
                ? {
                      issuerUrl: process.env.OIDC_ISSUER_URL ?? "https://accounts.google.com",
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

    const extraModules = [ThreadModule.create(persistence)];

    const app = await NestFactory.create(AppModule.register(AuthModule.create(authService), extraModules));

    app.enableCors({
        origin: frontendUrl,
    });

    const httpServer = app.getHttpAdapter().getHttpServer() as Server;

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

    const realtime = new ChatRealtimeServer({
        agent,
        persistence,
        cors: {
            origin: frontendUrl,
        },
        validateToken: (token: string) => authService.authenticateToken(token),
        generateTitle,
    });
    realtime.attach(httpServer);

    const port = process.env.PORT ?? "3000";
    await app.listen(port);
    console.log(`Backend listening on port ${port}`);

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
        console.log("Shutting down...");
        await realtime.close();
        await app.close();
        await destroyPersistence();
        process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
}

void bootstrap();
