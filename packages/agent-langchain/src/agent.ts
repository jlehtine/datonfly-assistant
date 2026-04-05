import { randomUUID } from "node:crypto";

import { ChatAnthropic } from "@langchain/anthropic";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { IterableReadableStream } from "@langchain/core/utils/stream";

import type { IChatAgent, ShouldRespondResult, ThreadMessage } from "@verbal-assistant/core";

export interface LangGraphAgentConfig {
    modelName?: string | undefined;
    apiKey?: string | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
}

export class LangGraphAgent implements IChatAgent {
    private readonly model: ChatAnthropic;

    constructor(config: LangGraphAgentConfig = {}) {
        const options: ConstructorParameters<typeof ChatAnthropic>[0] = {
            model: config.modelName ?? "claude-sonnet-4-20250514",
            temperature: config.temperature ?? 0.7,
            maxTokens: config.maxTokens ?? 4096,
        };
        if (config.apiKey) {
            options.anthropicApiKey = config.apiKey;
        }
        this.model = new ChatAnthropic(options);
    }

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

    async stream(
        messages: BaseMessage[],
        _threadId: string,
        _userId: string,
    ): Promise<IterableReadableStream<AIMessageChunk>> {
        return this.model.stream(messages);
    }

    shouldRespond(_messages: BaseMessage[], _threadId: string): Promise<ShouldRespondResult> {
        return Promise.resolve({ shouldRespond: true });
    }
}
