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

/** Map a tool name to a user-visible status string, or `undefined`. */
function toolNameToStatus(name: unknown): string | undefined {
    if (typeof name !== "string") return undefined;
    if (CODE_EXECUTION_TOOL_NAMES.has(name)) return "Running code\u2026";
    if (name === "web_search") return "Searching the web\u2026";
    return undefined;
}

/**
 * Detect whether any part of a streaming chunk indicates a server tool
 * invocation and return an appropriate status string, or `undefined`.
 *
 * LangChain may place `server_tool_use` blocks in `content`, but during
 * streaming it often routes them into `tool_call_chunks` or even
 * `invalid_tool_calls` (see LangChain #9911).  We check all three.
 */
function detectToolStatus(chunk: Record<string, unknown>): string | undefined {
    // 1. Check content blocks (works for non-streaming / invoke)
    const content = chunk.content;
    if (Array.isArray(content)) {
        for (const block of content as Record<string, unknown>[]) {
            if (block.type === "server_tool_use") {
                const s = toolNameToStatus(block.name);
                if (s) return s;
            }
        }
    }

    // 2. Check tool_call_chunks (streaming path)
    const toolCallChunks = chunk.tool_call_chunks;
    if (Array.isArray(toolCallChunks)) {
        for (const tc of toolCallChunks as Record<string, unknown>[]) {
            const s = toolNameToStatus(tc.name);
            if (s) return s;
        }
    }

    // 3. Check invalid_tool_calls (LangChain bug workaround)
    const invalidToolCalls = chunk.invalid_tool_calls;
    if (Array.isArray(invalidToolCalls)) {
        for (const tc of invalidToolCalls as Record<string, unknown>[]) {
            const s = toolNameToStatus(tc.name);
            if (s) return s;
        }
    }

    return undefined;
}

/** A URL + title pair extracted from a web search citation. */
interface Citation {
    url: string;
    title: string;
}

/** Extract web-search citations from content blocks. */
function extractCitations(content: string | Record<string, unknown>[]): Citation[] {
    if (typeof content === "string") return [];
    const citations: Citation[] = [];
    for (const block of content) {
        if (block.type !== "text" || !Array.isArray(block.citations)) continue;
        for (const cite of block.citations as Record<string, unknown>[]) {
            if (typeof cite.url === "string" && typeof cite.title === "string") {
                citations.push({ url: cite.url, title: cite.title });
            }
        }
    }
    return citations;
}

/** Build a deduplicated markdown "Sources" section from collected citations. */
function buildSourcesSection(citations: Citation[]): string {
    const seen = new Set<string>();
    const unique: Citation[] = [];
    for (const c of citations) {
        if (!seen.has(c.url)) {
            seen.add(c.url);
            unique.push(c);
        }
    }
    if (unique.length === 0) return "";
    const lines = unique.map((c) => `- [${c.title}](${c.url})`);
    return `\n\n---\n**Sources**\n${lines.join("\n")}\n`;
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
    /**
     * Enable the Anthropic server-side web search tool (`web_search_20260209`).
     *
     * Requires {@link enableCodeExecution} to also be `true` (the 2026 version
     * uses code execution for dynamic result filtering).
     */
    enableWebSearch?: boolean | undefined;
    /** Maximum number of web searches per request. Defaults to unlimited when omitted. */
    webSearchMaxUses?: number | undefined;
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
        if (config.enableWebSearch) {
            const webSearchTool: Record<string, unknown> = {
                type: "web_search_20260209",
                name: "web_search",
            };
            if (config.webSearchMaxUses != null) {
                webSearchTool.max_uses = config.webSearchMaxUses;
            }
            serverTools.push(webSearchTool as ServerTool);
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
        const citations = extractCitations(response.content);
        const sources = buildSourcesSection(citations);
        return { role: "ai", content: text + sources };
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
                const allCitations: Citation[] = [];
                for await (const chunk of langchainStream) {
                    const rawChunk = chunk as Record<string, unknown>;
                    const rawContent = rawChunk.content as string | Record<string, unknown>[];
                    const text = extractTextFromContent(rawContent);
                    const status = detectToolStatus(rawChunk);
                    allCitations.push(...extractCitations(rawContent));

                    if (text || status) {
                        yield { content: text, ...(status ? { status } : {}) };
                    }
                }
                const sources = buildSourcesSection(allCitations);
                if (sources) {
                    yield { content: sources };
                }
            },
        };
    }

    /** Always resolves to `{ shouldRespond: true }` for this implementation. */
    shouldRespond(_messages: AgentMessage[], _threadId: string): Promise<ShouldRespondResult> {
        return Promise.resolve({ shouldRespond: true });
    }
}
