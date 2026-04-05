import { randomUUID } from "node:crypto";

import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { IterableReadableStream } from "@langchain/core/utils/stream";

import type { IChatAgent, ShouldRespondResult, ThreadMessage } from "@verbal-assistant/core";

/** Configuration options for {@link LangGraphAgent}. */
export interface LangGraphAgentConfig {
    /** Anthropic model identifier (e.g. `"claude-3-5-sonnet-20241022"`). */
    modelName: string;
    /** Anthropic API key. Falls back to the `ANTHROPIC_API_KEY` environment variable when omitted. */
    apiKey?: string | undefined;
    /** Sampling temperature in `[0, 1]`. Defaults to `0.7`. */
    temperature?: number | undefined;
    /** Maximum number of tokens in the generated response. Defaults to `4096`. */
    maxTokens?: number | undefined;
}

/**
 * Chat agent backed by an Anthropic model via LangChain.
 *
 * Implements {@link IChatAgent} with both one-shot and streaming response modes.
 */
export class LangGraphAgent implements IChatAgent {
    private readonly model: ChatAnthropic;

    /** Create the agent with the given model configuration. */
    constructor(config: LangGraphAgentConfig) {
        const options: ConstructorParameters<typeof ChatAnthropic>[0] = {
            model: config.modelName,
            temperature: config.temperature ?? 0.7,
            maxTokens: config.maxTokens ?? 4096,
        };
        if (config.apiKey) {
            options.anthropicApiKey = config.apiKey;
        }
        this.model = new ChatAnthropic(options);
    }

    /** Run the agent and return a single complete assistant message. */
    async run(messages: BaseMessage[], threadId: string, _userId: string): Promise<ThreadMessage> {
        const response = await this.model.invoke(messages);
        const text = typeof response.content === "string" ? response.content : "";
        return {
            id: randomUUID(),
            threadId,
            role: "assistant",
            content: [{ type: "text", text }],
            authorId: null,
            createdAt: new Date(),
        };
    }

    /** Run the agent and return a stream of incremental AI message chunks. */
    async stream(
        messages: BaseMessage[],
        _threadId: string,
        _userId: string,
    ): Promise<IterableReadableStream<AIMessageChunk>> {
        return this.model.stream(messages);
    }

    /** Always resolves to `{ shouldRespond: true }` for this implementation. */
    shouldRespond(_messages: BaseMessage[], _threadId: string): Promise<ShouldRespondResult> {
        return Promise.resolve({ shouldRespond: true });
    }
}
