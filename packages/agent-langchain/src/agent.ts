import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { ServerTool } from "@langchain/core/tools";

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

/** Server-tool names that indicate code execution activity. */
const CODE_EXECUTION_TOOL_NAMES = new Set(["code_execution", "bash_code_execution", "text_editor_code_execution"]);

/**
 * Extract the concatenated text from a LangChain content value.
 *
 * When server tools are bound, `chunk.content` may be an array of content
 * blocks instead of a plain string. This helper normalises both forms to
 * a single string.
 */
function extractTextFromContent(content: string | Record<string, unknown>[]): string {
    if (typeof content === "string") return content;
    return content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("");
}

/**
 * Detect whether any content block is a `server_tool_use` for code execution
 * and return an appropriate status string, or `undefined`.
 */
function detectCodeExecutionStatus(content: string | Record<string, unknown>[]): string | undefined {
    if (typeof content === "string") return undefined;
    const hasCodeExec = content.some(
        (block) => block.type === "server_tool_use" && CODE_EXECUTION_TOOL_NAMES.has(block.name as string),
    );
    return hasCodeExec ? "Running code\u2026" : undefined;
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
    /** Enable the Anthropic server-side code execution tool (`code_execution_20260120`). */
    enableCodeExecution?: boolean | undefined;
}

/**
 * Chat agent backed by an Anthropic model via LangChain.
 *
 * Implements {@link IAgentProvider} with both one-shot and streaming response modes.
 */
export class LangGraphAgent implements IAgentProvider {
    private readonly model: ChatAnthropic;
    /** Model with server tools bound (if any are enabled), or the base model. */
    private readonly runnableModel: Runnable;

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

        const serverTools: ServerTool[] = [];
        if (config.enableCodeExecution) {
            serverTools.push({ type: "code_execution_20260120", name: "code_execution" } as ServerTool);
        }
        this.runnableModel = serverTools.length > 0 ? this.model.bindTools(serverTools) : this.model;
    }

    /** Run the agent and return a single complete assistant message. */
    async run(
        messages: AgentMessage[],
        _threadId: string,
        _userId: string,
        signal?: AbortSignal,
    ): Promise<AgentMessage> {
        const opts = signal ? { signal } : undefined;
        const response = (await this.runnableModel.invoke(agentMessagesToBaseMessages(messages), opts)) as {
            content: string | Record<string, unknown>[];
        };
        const text = extractTextFromContent(response.content);
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
        const langchainStream = await this.runnableModel.stream(agentMessagesToBaseMessages(messages), opts);
        return {
            async *[Symbol.asyncIterator]() {
                for await (const chunk of langchainStream) {
                    const rawContent = (chunk as { content: string | Record<string, unknown>[] }).content;
                    const text = extractTextFromContent(rawContent);
                    const status = detectCodeExecutionStatus(rawContent);

                    if (text || status) {
                        yield { content: text, ...(status ? { status } : {}) };
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
