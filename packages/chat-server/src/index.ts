export { AuditLogger } from "./audit-logger.js";
export type { AuditData } from "./audit-logger.js";
export { ChatModule } from "./chat.module.js";
export type { ChatModuleConfig } from "./chat.module.js";
export { ChatGateway } from "./chat.gateway.js";
export { ThreadController } from "./thread.controller.js";
export { UserController } from "./user.controller.js";
export { RequireUserGuard } from "./guards/require-user.guard.js";
export { ResolvedUser } from "./decorators/user.decorator.js";
export { ZodValidationPipe } from "./pipes/zod-validation.pipe.js";
export {
    PERSISTENCE_PROVIDER,
    AGENT_PROVIDER,
    VALIDATE_TOKEN_FN,
    GENERATE_TITLE_FN,
    COMPACTION_AGENT_PROVIDER,
    CHAT_CORS_OPTIONS,
} from "./constants.js";

export type { ValidateTokenFn } from "./chat.gateway.js";
export { ThreadTitleGenerator } from "./title-generator.js";
export type { GenerateTitleFn, OnTitleUpdatedFn, ThreadTitleGeneratorConfig } from "./title-generator.js";
export { threadMessagesToAgentMessages, extractText } from "./messages.js";
