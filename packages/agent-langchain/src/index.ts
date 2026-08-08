export { AnthropicAgent } from "./agent.js";
export type { AnthropicAgentConfig, AnthropicProviderOptions } from "./agent.js";
export { createTitleGenerateFn } from "./title.js";
export type { TitleModelConfig } from "./title.js";

// Re-export the vendor-neutral tool and per-call option contracts so embedders
// can build tools and drive the agent without depending on `@langchain/*`
// types. These are single-sourced in `@datonfly-assistant/core`.
export type { AgentCapabilities, AgentConfig, AgentRunOptions, ITool, JsonSchema } from "@datonfly-assistant/core";
export { zodTool } from "@datonfly-assistant/core";
