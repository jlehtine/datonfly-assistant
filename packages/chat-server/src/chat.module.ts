import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { ThrottlerModule, type ThrottlerOptions, type ThrottlerStorage } from "@nestjs/throttler";
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
import { AttachmentController } from "./attachment.controller.js";
import {
    ADMIN_IPS,
    ADMIN_SECRET,
    AGENT_PROVIDER,
    CHAT_CORS_OPTIONS,
    MEMBER_SEARCH_STRATEGY,
    PERSISTENCE_PROVIDER,
    RATE_LIMIT_CONFIG,
    SEARCH_PROVIDER,
    SEARCH_RECENCY_HALF_LIFE_DAYS,
    SEARCH_RECENCY_WEIGHT,
    TRANSCRIBE_FN,
    TRUSTED_REVERSE_PROXY,
    VALIDATE_TOKEN_FN,
} from "./constants.js";
import { AdminGuard } from "./guards/admin.guard.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";
import { RateLimitService } from "./rate-limit/rate-limit.service.js";
import { resolveHttpTier } from "./rate-limit/rate-tier.decorator.js";
import { TieredThrottlerGuard } from "./rate-limit/throttler.guard.js";
import {
    HTTP_TIERS,
    resolveRateLimitConfig,
    type RateLimitOptions,
    type ResolvedRateLimitConfig,
} from "./rate-limit/tiers.js";
import { TrustedProxyService, type TrustedReverseProxy } from "./trusted-proxy.service.js";
import { ThreadController } from "./thread.controller.js";
import { TranscriptionController, type TranscribeFn } from "./transcription.controller.js";
import { UserController } from "./user.controller.js";
import type { ValidateTokenFn } from "./chat.gateway.js";

/** Build one named throttler per HTTP tier; `skipIf` selects the matching tier. */
function buildHttpThrottlers(config: ResolvedRateLimitConfig): ThrottlerOptions[] {
    const reflector = new Reflector();
    return HTTP_TIERS.map((tier) => {
        const { ttlMs, limit } = config.tiers[tier];
        return {
            name: tier,
            ttl: ttlMs,
            limit,
            blockDuration: ttlMs,
            skipIf: (context) => context.getType() !== "http" || resolveHttpTier(context, reflector) !== tier,
        };
    });
}

interface RequestLogSource {
    method: string;
    url: string;
    ip?: string | undefined;
    ips?: string[] | undefined;
    socket?: { remoteAddress?: string | undefined } | undefined;
    raw?: {
        ip?: string | undefined;
        ips?: string[] | undefined;
        socket?: { remoteAddress?: string | undefined } | undefined;
    };
}

function resolveRequestIp(req: RequestLogSource): string {
    return (
        req.ip ??
        req.raw?.ip ??
        req.ips?.[0] ??
        req.raw?.ips?.[0] ??
        req.socket?.remoteAddress ??
        req.raw?.socket?.remoteAddress ??
        ""
    );
}

/** Configuration for {@link ChatModule.forRoot}. */
export interface ChatModuleConfig {
    /** Chat agent that processes incoming messages and streams responses. */
    agent: IAgentProvider;
    /** Persistence provider for threads, messages, and users. */
    persistence: IPersistenceProvider;
    /** Token validation callback for WebSocket authentication. */
    validateToken?: ValidateTokenFn | undefined;
    /**
     * Callback that transcribes uploaded audio to text.
     *
     * When provided, the `/transcribe` endpoint is enabled and the server
     * advertises the `audioInput` feature in the welcome event. The audio is
     * never persisted; only the transcribed text is.
     */
    transcribe?: TranscribeFn | undefined;
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
    /**
     * Half-life for search recency decay scoring, in days.
     *
     * A message from `N` days ago is scored as `rawScore * exp(-ln(2) / halfLife * N)`,
     * so a message this many days old contributes half the score of a message from today.
     * Defaults to 360 days.
     */
    searchRecencyHalfLifeDays?: number | undefined;
    /**
     * Weight of the recency boost relative to relevance ranking, applied on top of the fused
     * dense/sparse score. Defaults to `0.15`.
     */
    searchRecencyWeight?: number | undefined;
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
    /** Pino log level for the request logger. Defaults to `"info"`. */
    logLevel?: string | undefined;
    /**
     * Log output format. `"json"` emits machine-parseable JSON lines; any other
     * value (the default) uses human-readable pretty output.
     */
    logFormat?: "json" | "pretty" | undefined;
    /**
     * Rate-limiting configuration. Enabled by default with sane per-tier limits.
     *
     * Tune the whole deployment up or down with `factor`, optionally bound the
     * shared expensive-resource pool with `expectedUsers`, or disable entirely
     * with `enabled: false`. Provide a custom `storage` to share limit state
     * across multiple instances (defaults to in-memory).
     */
    rateLimit?: (RateLimitOptions & { storage?: ThrottlerStorage | undefined }) | undefined;
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
        const rateLimit = resolveRateLimitConfig(config.rateLimit);
        return {
            module: ChatModule,
            imports: [
                LoggerModule.forRoot({
                    pinoHttp: {
                        level: config.logLevel ?? "info",
                        ...(config.logFormat === "json"
                            ? {}
                            : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
                        redact: {
                            paths: ["email", "name", "content", "text", "*.email", "*.name", "*.content", "*.text"],
                            censor: "[REDACTED]",
                        },
                        serializers: {
                            req(req: RequestLogSource) {
                                return { method: req.method, url: req.url, ip: resolveRequestIp(req) };
                            },
                            res(res: { statusCode: number }) {
                                return { statusCode: res.statusCode };
                            },
                        },
                    },
                }),
                ...(rateLimit.enabled
                    ? [
                          ThrottlerModule.forRoot({
                              throttlers: buildHttpThrottlers(rateLimit),
                              ...(config.rateLimit?.storage ? { storage: config.rateLimit.storage } : {}),
                          }),
                      ]
                    : []),
            ],
            controllers: [
                ThreadController,
                UserController,
                AdminController,
                TranscriptionController,
                AttachmentController,
            ],
            providers: [
                { provide: AGENT_PROVIDER, useValue: config.agent },
                { provide: PERSISTENCE_PROVIDER, useValue: config.persistence },
                { provide: VALIDATE_TOKEN_FN, useValue: config.validateToken ?? null },
                { provide: TRANSCRIBE_FN, useValue: config.transcribe ?? null },
                { provide: CHAT_CORS_OPTIONS, useValue: config.cors ?? null },
                { provide: MEMBER_SEARCH_STRATEGY, useValue: config.memberSearchStrategy ?? "default" },
                { provide: SEARCH_PROVIDER, useValue: config.search ?? null },
                { provide: SEARCH_RECENCY_HALF_LIFE_DAYS, useValue: config.searchRecencyHalfLifeDays ?? 360 },
                { provide: SEARCH_RECENCY_WEIGHT, useValue: config.searchRecencyWeight ?? 0.15 },
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
                { provide: RATE_LIMIT_CONFIG, useValue: rateLimit },
                RateLimitService,
                ...(rateLimit.enabled ? [{ provide: APP_GUARD, useClass: TieredThrottlerGuard }] : []),
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
