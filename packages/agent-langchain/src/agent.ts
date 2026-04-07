import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";

import type { AgentMessage, AgentStreamChunk, IAgentProvider, ShouldRespondResult } from "@datonfly-assistant/core";

/** Convert framework-agnostic {@link AgentMessage} instances to LangChain {@link BaseMessage} instances. */
function agentMessagesToBaseMessages(messages: AgentMessage[]): BaseMessage[] {
    return messages.map((msg) => {
        switch (msg.role) {
            case "human":
                return new HumanMessage(msg.content);
            case "ai":
                return new AIMessage(msg.content);
            case "system":
                return new SystemMessage(msg.content);
        }
    });
}

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
 * Implements {@link IAgentProvider} with both one-shot and streaming response modes.
 */
export class LangGraphAgent implements IAgentProvider {
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
    async run(
        messages: AgentMessage[],
        _threadId: string,
        _userId: string,
        signal?: AbortSignal,
    ): Promise<AgentMessage> {
        const opts = signal ? { signal } : undefined;
        const response = await this.model.invoke(agentMessagesToBaseMessages(messages), opts);
        const text = typeof response.content === "string" ? response.content : "";
        return { role: "ai", content: text };
    }

    /** Run the agent and return a stream of incremental response chunks. */
    async stream(
        messages: AgentMessage[],
        _threadId: string,
        _userId: string,
        signal?: AbortSignal,
    ): Promise<AsyncIterable<AgentStreamChunk>> {
        const opts = signal ? { signal } : undefined;
        const langchainStream = await this.model.stream(agentMessagesToBaseMessages(messages), opts);
        return {
            async *[Symbol.asyncIterator]() {
                for await (const chunk of langchainStream) {
                    const content = typeof chunk.content === "string" ? chunk.content : "";
                    if (content) {
                        yield { content };
                    }
                }
            },
        };
    }

    /** Always resolves to `{ shouldRespond: true }` for this implementation. */
    shouldRespond(_messages: AgentMessage[], _threadId: string): Promise<ShouldRespondResult> {
        return Promise.resolve({ shouldRespond: true });
    }
}
