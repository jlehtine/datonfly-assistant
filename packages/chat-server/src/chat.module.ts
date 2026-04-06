import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import type { IAgentProvider, IPersistenceProvider } from "@datonfly-assistant/core";

import { ChatGateway } from "./chat.gateway.js";
import {
    AGENT_PROVIDER,
    CHAT_CORS_OPTIONS,
    GENERATE_TITLE_FN,
    PERSISTENCE_PROVIDER,
    VALIDATE_TOKEN_FN,
} from "./constants.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";
import type { GenerateTitleFn } from "./title-generator.js";
import { ThreadController } from "./thread.controller.js";
import type { ValidateTokenFn } from "./server.js";

/** Configuration for {@link ChatModule.forRoot}. */
export interface ChatModuleConfig {
    /** Chat agent that processes incoming messages and streams responses. */
    agent: IAgentProvider;
    /** Persistence provider for threads, messages, and users. */
    persistence: IPersistenceProvider;
    /** Token validation callback for WebSocket authentication. */
    validateToken?: ValidateTokenFn | undefined;
    /** Callback that generates a thread title from conversation messages. */
    generateTitle?: GenerateTitleFn | undefined;
    /** CORS configuration forwarded to the WebSocket gateway. */
    cors?: { origin: string | string[] } | undefined;
}

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ChatModule {
    /**
     * Register the chat module with all required providers.
     *
     * The host application is responsible for authenticating HTTP requests and
     * populating `req.user` with a {@link UserIdentity} before chat-server
     * controllers are invoked.  The {@link RequireUserGuard} enforces this
     * contract and resolves the identity to a full `User` record via the
     * persistence provider.
     *
     * For WebSocket connections, pass a `validateToken` callback that maps a
     * raw token string to a `UserIdentity`.
     */
    static forRoot(config: ChatModuleConfig): DynamicModule {
        return {
            module: ChatModule,
            controllers: [ThreadController],
            providers: [
                { provide: AGENT_PROVIDER, useValue: config.agent },
                { provide: PERSISTENCE_PROVIDER, useValue: config.persistence },
                { provide: VALIDATE_TOKEN_FN, useValue: config.validateToken ?? null },
                { provide: GENERATE_TITLE_FN, useValue: config.generateTitle ?? null },
                { provide: CHAT_CORS_OPTIONS, useValue: config.cors ?? null },
                RequireUserGuard,
                ChatGateway,
            ],
            exports: [PERSISTENCE_PROVIDER, AGENT_PROVIDER],
        };
    }
}
