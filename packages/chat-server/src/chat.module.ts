import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import type {
    IAgentProvider,
    IPersistenceProvider,
    ISearchProvider,
    MemberSearchStrategy,
} from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { ChatGateway } from "./chat.gateway.js";
import { AdminController } from "./admin.controller.js";
import {
    ADMIN_IPS,
    ADMIN_SECRET,
    AGENT_PROVIDER,
    CHAT_CORS_OPTIONS,
    GENERATE_TITLE_FN,
    MEMBER_SEARCH_STRATEGY,
    PERSISTENCE_PROVIDER,
    SEARCH_PROVIDER,
    TRUSTED_REVERSE_PROXY,
    VALIDATE_TOKEN_FN,
} from "./constants.js";
import { AdminGuard } from "./guards/admin.guard.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";
import { TrustedProxyService, type TrustedReverseProxy } from "./trusted-proxy.service.js";
import type { GenerateTitleFn } from "./title-generator.js";
import { ThreadController } from "./thread.controller.js";
import { UserController } from "./user.controller.js";
import type { ValidateTokenFn } from "./chat.gateway.js";

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
    cors?: { origin: string | string[]; credentials?: boolean | undefined } | undefined;
    /**
     * Controls how the user-search endpoint behaves for member invites.
     *
     * - `"default"` (default) – any registered user can be discovered by partial name/email match.
     * - `"limited-visibility"` – search only returns users who already share a thread with the searcher.
     */
    memberSearchStrategy?: MemberSearchStrategy | undefined;
    /** Optional semantic search provider for thread search and message indexing. */
    search?: ISearchProvider | undefined;
    /** Shared secret for admin endpoints. Both `adminSecret` and `adminIps` must be set. */
    adminSecret?: string | undefined;
    /** Allowed IP addresses or CIDR ranges for admin endpoints (whitespace/comma-delimited). */
    adminIps?: string | undefined;
    /**
     * Trusted reverse-proxy setting forwarded to Express `trust proxy`.
     *
     * Use this when chat-server is behind ingress/reverse proxies so `req.ip`
     * resolves to the actual client IP from forwarded headers.
     */
    trustedReverseProxy?: TrustedReverseProxy | undefined;
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
            imports: [
                LoggerModule.forRoot({
                    pinoHttp: {
                        level: process.env.LOG_LEVEL ?? "info",
                        ...(process.env.LOG_FORMAT === "json"
                            ? {}
                            : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
                        redact: {
                            paths: ["email", "name", "content", "text", "*.email", "*.name", "*.content", "*.text"],
                            censor: "[REDACTED]",
                        },
                        serializers: {
                            req(req: {
                                method: string;
                                url: string;
                                ip?: string | undefined;
                                ips?: string[] | undefined;
                            }) {
                                return { method: req.method, url: req.url, ip: req.ip ?? req.ips?.[0] ?? "" };
                            },
                            res(res: { statusCode: number }) {
                                return { statusCode: res.statusCode };
                            },
                        },
                    },
                }),
            ],
            controllers: [ThreadController, UserController, AdminController],
            providers: [
                { provide: AGENT_PROVIDER, useValue: config.agent },
                { provide: PERSISTENCE_PROVIDER, useValue: config.persistence },
                { provide: VALIDATE_TOKEN_FN, useValue: config.validateToken ?? null },
                { provide: GENERATE_TITLE_FN, useValue: config.generateTitle ?? null },
                { provide: CHAT_CORS_OPTIONS, useValue: config.cors ?? null },
                { provide: MEMBER_SEARCH_STRATEGY, useValue: config.memberSearchStrategy ?? "default" },
                { provide: SEARCH_PROVIDER, useValue: config.search ?? null },
                { provide: TRUSTED_REVERSE_PROXY, useValue: config.trustedReverseProxy ?? null },
                { provide: ADMIN_SECRET, useValue: config.adminSecret ?? null },
                {
                    provide: ADMIN_IPS,
                    useValue: config.adminIps
                        ? config.adminIps
                              .split(/[\s,]+/)
                              .map((s) => s.trim())
                              .filter(Boolean)
                        : null,
                },
                RequireUserGuard,
                AdminGuard,
                AuditLogger,
                TrustedProxyService,
                ChatGateway,
            ],
            exports: [PERSISTENCE_PROVIDER, AGENT_PROVIDER, AuditLogger],
        };
    }
}
