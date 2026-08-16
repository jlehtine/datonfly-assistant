export { AnthropicAgent } from "./agent.js";
export type { AnthropicAgentConfig, AnthropicProviderOptions } from "./config.js";
export { PROVIDER_ID } from "./config.js";
export { describeApiError, isAbortError, isRetryableApiError, toErrorCode } from "./errors.js";
export type { ApiErrorDetails } from "./errors.js";

// Re-export vendor-neutral contracts so embedders need only this package.
export type { AgentRunOptions, ITool } from "@datonfly-assistant/core";
