import "reflect-metadata";

import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";

import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";

import { LangGraphAgent } from "@verbal-assistant/agent-langchain";
import { ChatRealtimeServer } from "@verbal-assistant/realtime";

import { AppModule } from "./app.module.js";

// Load .env from monorepo root (two levels up from packages/backend)
for (const candidate of [".env", "../../.env"]) {
    const abs = resolve(candidate);
    if (existsSync(abs)) {
        config({ path: abs });
        break;
    }
}

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    app.enableCors({
        origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
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

    const realtime = new ChatRealtimeServer({
        agent,
        cors: {
            origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
        },
    });
    realtime.attach(httpServer);

    const port = process.env.PORT ?? "3000";
    await app.listen(port);
    console.log(`Backend listening on port ${port}`);
}

void bootstrap();
