export { AuditLogger } from "./audit-logger.js";
export type { AuditData } from "./audit-logger.js";
export { ChatModule } from "./chat.module.js";
export type { ChatModuleConfig } from "./chat.module.js";
export { AdminController } from "./admin.controller.js";
export { AttachmentController } from "./attachment.controller.js";
export { ChatGateway } from "./chat.gateway.js";
export { ThreadController } from "./thread.controller.js";
export { TranscriptionController } from "./transcription.controller.js";
export type { TranscribeFn } from "./transcription.controller.js";
export { UserController } from "./user.controller.js";
export { RequireUserGuard } from "./guards/require-user.guard.js";
export { ResolvedUser } from "./decorators/user.decorator.js";
export { ZodValidationPipe } from "./pipes/zod-validation.pipe.js";
export {
    PERSISTENCE_PROVIDER,
    AGENT_PROVIDER,
    VALIDATE_TOKEN_FN,
    CHAT_CORS_OPTIONS,
    MEMBER_SEARCH_STRATEGY,
    SEARCH_PROVIDER,
    ADMIN_SECRET,
    ADMIN_IPS,
    TRUSTED_REVERSE_PROXY,
} from "./constants.js";

export type { ValidateTokenFn } from "./chat.gateway.js";
export { ThreadTitleGenerator } from "./title-generator.js";
export type { OnTitleUpdatedFn, ThreadTitleGeneratorConfig } from "./title-generator.js";
export { threadMessagesToAgentMessages, extractText } from "./messages.js";
export type { TrustedReverseProxy } from "./trusted-proxy.service.js";
export { RateTier } from "./rate-limit/rate-tier.decorator.js";
export { RateLimitService } from "./rate-limit/rate-limit.service.js";
export type { RateDecision } from "./rate-limit/rate-limit.service.js";
export { RATE_LIMIT_TIER_DEFAULTS, resolveRateLimitConfig, computeTierLimit } from "./rate-limit/tiers.js";
export type { RateLimitTier, RateLimitOptions, ResolvedRateLimitConfig, TierLimit } from "./rate-limit/tiers.js";
