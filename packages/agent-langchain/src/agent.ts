import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { ServerTool } from "@langchain/core/tools";

import {
    NOOP_PROVIDER_LOGGER,
    type AgentMessage,
    type AgentStreamChunk,
    type AgentUsage,
    type Citation,
    type ContentPart,
    type IAgentProvider,
    type OpaqueContentPart,
    type ProviderLogger,
    type ShouldRespondResult,
    type StatusCode,
    type TextContentPart,
    type ThinkingContentPart,
} from "@datonfly-assistant/core";

/** The opaque block provider identifier used by this agent. */
const PROVIDER_ID = "anthropic";

interface AssistantApiErrorDetails {
    errorName?: string | undefined;
    errorMessage?: string | undefined;
    errorCode?: string | undefined;
    errorType?: string | undefined;
    apiStatusCode?: number | undefined;
    requestId?: string | undefined;
    retryAfterSeconds?: number | undefined;
    isAbortError?: boolean | undefined;
}

function isDebugApiContentEnabled(): boolean {
    return process.env.DEBUG_API_CONTENT === "true";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readHeaderValue(headers: Record<string, unknown>, key: string): string | undefined {
    const direct = asString(headers[key]);
    if (direct) return direct;
    const lower = asString(headers[key.toLowerCase()]);
    if (lower) return lower;
    return undefined;
}

function parseRetryAfterSeconds(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return undefined;
}

function extractAssistantApiErrorDetails(error: unknown): AssistantApiErrorDetails {
    if (!isRecord(error)) {
        return {
            errorMessage: error instanceof Error ? error.message : undefined,
            errorName: error instanceof Error ? error.name : undefined,
        };
    }

    const response = isRecord(error.response) ? error.response : undefined;
    const topHeaders = isRecord(error.headers) ? error.headers : undefined;
    const responseHeaders = response && isRecord(response.headers) ? response.headers : undefined;
    const errorPayload = isRecord(error.error) ? error.error : undefined;

    const statusCode =
        asNumber(error.status) ?? asNumber(error.statusCode) ?? (response ? asNumber(response.status) : undefined);
    const requestId =
        asString(error.request_id) ??
        asString(error.requestId) ??
        (topHeaders ? readHeaderValue(topHeaders, "x-request-id") : undefined) ??
        (responseHeaders ? readHeaderValue(responseHeaders, "x-request-id") : undefined);
    const retryAfterSeconds =
        parseRetryAfterSeconds(topHeaders ? readHeaderValue(topHeaders, "retry-after") : undefined) ??
        parseRetryAfterSeconds(responseHeaders ? readHeaderValue(responseHeaders, "retry-after") : undefined);

    return {
        errorName: asString(error.name),
        errorMessage: asString(error.message),
        errorCode: asString(error.code) ?? (errorPayload ? asString(errorPayload.code) : undefined),
        errorType: asString(error.type) ?? (errorPayload ? asString(errorPayload.type) : undefined),
        apiStatusCode: statusCode,
        requestId,
        retryAfterSeconds,
        isAbortError:
            asString(error.name) === "AbortError" ||
            asString(error.code) === "ABORT_ERR" ||
            asString(error.code) === "ERR_CANCELED",
    };
}

/**
 * Convert framework-agnostic {@link AgentMessage} instances to LangChain {@link BaseMessage} instances.
 *
 * When an AI message carries opaque parts with Anthropic compaction data, the
 * compaction block is included in the content array so LangChain sends it back
 * to the API.
 */
function agentMessagesToBaseMessages(messages: AgentMessage[]): BaseMessage[] {
    return messages.map((msg) => {
        const textParts = msg.content.filter((p): p is TextContentPart => p.type === "text");
        const text = textParts.map((p) => p.text).join("");

        switch (msg.role) {
            case "human":
                return new HumanMessage(text);
            case "system":
                return new SystemMessage(text);
            case "ai": {
                // Build LangChain content blocks from typed parts.
                // NOTE: We intentionally do not replay persisted thinking blocks
                // in request context. Anthropic requires thinking/redacted_thinking
                // blocks in the latest assistant message to be byte-identical to
                // the original response; reconstructed persisted parts can violate
                // that constraint and cause 400 invalid_request_error.
                const contentBlocks: Record<string, unknown>[] = [];
                for (const part of msg.content) {
                    if (part.type === "opaque" && part.provider === PROVIDER_ID) {
                        const data = part.data as Record<string, unknown>;
                        if (data.type === "compaction" && typeof data.content === "string") {
                            contentBlocks.push({ type: "compaction", content: data.content });
                        }
                    } else if (part.type === "text") {
                        contentBlocks.push({ type: "text", text: part.text });
                    }
                    // tool-call, tool-result, unknown opaque: skip (not sent to Anthropic directly)
                }
                if (contentBlocks.length === 0) return new AIMessage("");
                if (contentBlocks.length === 1 && contentBlocks[0]?.type === "text") {
                    return new AIMessage(contentBlocks[0].text as string);
                }
                return new AIMessage({ content: contentBlocks as AIMessage["content"] });
            }
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

/** A streamed text segment annotated with its semantic part type. */
interface StreamTextPart {
    partType: "thinking" | "text";
    text: string;
    reasoningKey?: string | undefined;
}

/** Extract streamed text segments from a LangChain content value. */
function extractTextPartsFromContent(
    content: string | Record<string, unknown>[],
    orderCounter: number,
): StreamTextPart[] {
    if (typeof content === "string") {
        return content ? [{ partType: "text", text: content }] : [];
    }
    const parts: StreamTextPart[] = [];
    for (const [i, block] of content.entries()) {
        if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
            parts.push({ partType: "text", text: block.text });
            continue;
        }
        if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0) {
            const index = typeof block.index === "number" ? block.index : undefined;
            const key =
                index != null ? `thinking:${String(index)}` : `thinking:chunk:${String(orderCounter)}:${String(i)}`;
            parts.push({ partType: "thinking", text: block.thinking, reasoningKey: key });
        }
    }
    return parts;
}

/** Status info returned for a detected tool invocation. */
interface ToolStatus {
    code: StatusCode;
    text: string;
}

/** Map a tool name to a {@link ToolStatus}, or `undefined`. */
function toolNameToStatus(name: unknown): ToolStatus | undefined {
    if (typeof name !== "string") return undefined;
    if (CODE_EXECUTION_TOOL_NAMES.has(name)) return { code: "tool_code_execution", text: "Running code…" };
    if (name === "web_fetch") return { code: "tool_web_fetch", text: "Fetching page…" };
    if (name === "web_search") return { code: "tool_web_search", text: "Searching the web…" };
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
function detectToolStatus(chunk: Record<string, unknown>): ToolStatus | undefined {
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
interface RawCitation {
    url: string;
    title: string;
}

/** Extract web-search citations from content blocks. */
function extractCitations(content: string | Record<string, unknown>[]): RawCitation[] {
    if (typeof content === "string") return [];
    const citations: RawCitation[] = [];
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

/** Extract compaction blocks from content as {@link OpaqueContentPart} instances. */
function extractCompactionBlocks(content: string | Record<string, unknown>[]): OpaqueContentPart[] {
    if (typeof content === "string") return [];
    const blocks: OpaqueContentPart[] = [];
    for (const block of content) {
        if (block.type === "compaction" && typeof block.content === "string") {
            blocks.push({
                type: "opaque",
                provider: PROVIDER_ID,
                data: { type: "compaction", content: block.content },
            });
        }
    }
    return blocks;
}

interface AnthropicReasoningBlockState {
    order: number;
    index?: number | undefined;
    thinking?: string | undefined;
}

/** Merge Anthropic reasoning blocks from a streamed content chunk into state. */
function collectReasoningBlocks(
    content: string | Record<string, unknown>[],
    state: Map<string, AnthropicReasoningBlockState>,
    orderCounter: { value: number },
): void {
    if (typeof content === "string") return;

    for (const [i, block] of content.entries()) {
        if (block.type !== "thinking") continue;
        const index = typeof block.index === "number" ? block.index : undefined;
        const key =
            index != null ? `thinking:${String(index)}` : `thinking:chunk:${String(orderCounter.value)}:${String(i)}`;
        const existing = state.get(key) ?? { order: orderCounter.value, ...(index != null ? { index } : {}) };

        if (typeof block.thinking === "string" && block.thinking.length > 0) {
            existing.thinking = `${existing.thinking ?? ""}${block.thinking}`;
        }
        state.set(key, existing);
    }
}

/** Build persistent thinking parts from accumulated Anthropic reasoning state. */
function materializeThinkingParts(state: Map<string, AnthropicReasoningBlockState>): ThinkingContentPart[] {
    const entries = [...state.entries()].sort((a, b) => {
        const ai = a[1].index;
        const bi = b[1].index;
        if (ai != null && bi != null) return ai - bi;
        if (ai != null) return -1;
        if (bi != null) return 1;
        return a[1].order - b[1].order;
    });

    const parts: ThinkingContentPart[] = [];
    for (const [, value] of entries) {
        if (!value.thinking) continue;
        parts.push({
            type: "thinking",
            text: value.thinking,
        });
    }
    return parts;
}

/** Extract Anthropic thinking parts from a non-streamed content payload. */
function extractThinkingParts(content: string | Record<string, unknown>[]): ThinkingContentPart[] {
    const state = new Map<string, AnthropicReasoningBlockState>();
    collectReasoningBlocks(content, state, { value: 0 });
    return materializeThinkingParts(state);
}

/**
 * Trim messages before the latest compaction block.
 *
 * The Anthropic API ignores all content before a compaction block, so
 * sending those messages would only waste bandwidth. The system message
 * (index 0) is always preserved.
 */
function trimBeforeCompaction(messages: AgentMessage[]): AgentMessage[] {
    // Walk backwards to find the latest AI message with a compaction block.
    let compactionIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
            msg?.role === "ai" &&
            msg.content.some(
                (p) =>
                    p.type === "opaque" &&
                    p.provider === PROVIDER_ID &&
                    (p.data as Record<string, unknown>).type === "compaction",
            )
        ) {
            compactionIndex = i;
            break;
        }
    }
    if (compactionIndex <= 0) return messages;
    // Keep system message(s) at the start + everything from the compaction index onward.
    const system = messages.filter((m, i) => i < compactionIndex && m.role === "system");
    return [...system, ...messages.slice(compactionIndex)];
}

/** Deduplicate citations by URL. */
function deduplicateCitations(citations: RawCitation[]): Citation[] {
    const seen = new Set<string>();
    const unique: Citation[] = [];
    for (const c of citations) {
        if (!seen.has(c.url)) {
            seen.add(c.url);
            unique.push(c);
        }
    }
    return unique;
}

/** Configuration options for {@link LangGraphAgent}. */
export interface LangGraphAgentConfig {
    /** Anthropic model identifier (e.g. `"claude-3-5-sonnet-20241022"`). */
    modelName: string;
    /** Anthropic API key. Falls back to the `ANTHROPIC_API_KEY` environment variable when omitted. */
    apiKey?: string | undefined;
    /** Sampling temperature in `[0, 1]`. When omitted, the provider/model default is used. */
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
    /**
     * Enable the Anthropic server-side web fetch tool (`web_fetch_20260209`).
     *
     * Allows the agent to retrieve full content from URLs provided in the
     * conversation.  The `20260209` version supports dynamic filtering when
     * {@link enableCodeExecution} is also `true`.
     */
    enableWebFetch?: boolean | undefined;
    /** Maximum number of web fetches per request. Defaults to unlimited when omitted. */
    webFetchMaxUses?: number | undefined;
    /** Maximum content length (in tokens) for fetched pages. Defaults to unlimited when omitted. */
    webFetchMaxContentTokens?: number | undefined;
    /** Anthropic thinking mode (`adaptive` or `enabled`). When omitted, thinking stays disabled. */
    thinkingType?: "adaptive" | "enabled" | undefined;
    /** Anthropic thinking display mode. */
    thinkingDisplay?: "summarized" | "omitted" | undefined;
    /** Budget tokens for manual thinking mode (`enabled`). */
    thinkingBudgetTokens?: number | undefined;
    /** Optional output effort level used with adaptive thinking. */
    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
    /**
     * Anthropic model used to decide whether the agent should respond in
     * multi-user threads (e.g. `"claude-haiku-4-5"`).  When omitted the
     * agent always responds.
     */
    triageModelName?: string | undefined;
    /** Context window size of the model in tokens. Defaults to `200000`. */
    contextWindowSize?: number | undefined;
    /** Enable Anthropic provider-side context compaction. Defaults to `true`. */
    enableCompaction?: boolean | undefined;
    /**
     * Input token threshold at which the Anthropic API triggers compaction.
     * Defaults to `contextWindowSize * 0.6`.
     */
    compactionTriggerTokens?: number | undefined;

    /** Optional logger for assistant API failures. Defaults to a no-op logger when omitted. */
    logger?: ProviderLogger | undefined;
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
    /** Lazy-initialized cheap model for triage classification. */
    private triageModel: ChatAnthropic | null = null;
    private readonly triageModelName: string | undefined;
    private readonly triageApiKey: string | undefined;
    private readonly modelName: string;
    private readonly contextWindowSize: number;
    private readonly logger: ProviderLogger;

    /** @inheritdoc */
    readonly externalCompaction = false;

    /** Create the agent with the given model configuration. */
    constructor(config: LangGraphAgentConfig) {
        const enableCompaction = config.enableCompaction !== false;
        const options: ConstructorParameters<typeof ChatAnthropic>[0] = {
            model: config.modelName,
            maxTokens: config.maxTokens ?? 4096,
            streamUsage: true,
        };
        if (config.thinkingType) {
            const thinking: Record<string, unknown> = { type: config.thinkingType };
            if (config.thinkingDisplay) {
                thinking.display = config.thinkingDisplay;
            }
            if (config.thinkingType === "enabled" && typeof config.thinkingBudgetTokens === "number") {
                thinking.budget_tokens = config.thinkingBudgetTokens;
            }
            (options as { thinking?: unknown }).thinking = thinking;
            if (config.thinkingEffort) {
                (options as { outputConfig?: unknown }).outputConfig = {
                    effort: config.thinkingEffort,
                };
            }
        }
        if (typeof config.temperature === "number") {
            options.temperature = config.temperature;
        }
        if (enableCompaction) {
            options.contextManagement = {
                edits: [
                    {
                        type: "compact_20260112" as const,
                        trigger: {
                            type: "input_tokens",
                            value:
                                config.compactionTriggerTokens ??
                                Math.round((config.contextWindowSize ?? 200_000) * 0.6),
                        },
                    },
                ],
            };
        }
        if (config.apiKey) {
            options.anthropicApiKey = config.apiKey;
        }
        this.model = new ChatAnthropic(options);
        this.modelName = config.modelName;
        this.contextWindowSize = config.contextWindowSize ?? 200_000;
        this.triageModelName = config.triageModelName;
        this.triageApiKey = config.apiKey;
        this.logger = config.logger ?? NOOP_PROVIDER_LOGGER;

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
        if (config.enableWebFetch) {
            const webFetchTool: Record<string, unknown> = {
                type: "web_fetch_20260209",
                name: "web_fetch",
            };
            if (config.webFetchMaxUses != null) {
                webFetchTool.max_uses = config.webFetchMaxUses;
            }
            if (config.webFetchMaxContentTokens != null) {
                webFetchTool.max_content_tokens = config.webFetchMaxContentTokens;
            }
            serverTools.push(webFetchTool as ServerTool);
        }
        this.runnableModel = serverTools.length > 0 ? this.model.bindTools(serverTools) : this.model;
    }

    private createOperationLogger(
        operation: "run" | "stream" | "shouldRespond",
        fields: Record<string, unknown>,
    ): ProviderLogger {
        return this.logger.child({ vendor: PROVIDER_ID, model: this.modelName, operation, ...fields });
    }

    private logAssistantApiError(logger: ProviderLogger, error: unknown, fields: Record<string, unknown>): void {
        logger.error(
            {
                ...fields,
                ...extractAssistantApiErrorDetails(error),
            },
            "Assistant API call failed",
        );
    }

    /** Run the agent and return a single complete assistant message. */
    async run(messages: AgentMessage[], threadId: string, userId: string, signal?: AbortSignal): Promise<AgentMessage> {
        const logger = this.createOperationLogger("run", { threadId, userId });
        const trimmed = trimBeforeCompaction(messages);
        const opts = { cache_control: { type: "ephemeral" } as const, ...(signal ? { signal } : {}) };
        try {
            const response = (await this.runnableModel.invoke(agentMessagesToBaseMessages(trimmed), opts)) as {
                content: string | Record<string, unknown>[];
            };
            const text = extractTextFromContent(response.content);
            const thinkingParts = extractThinkingParts(response.content);
            const opaqueParts = extractCompactionBlocks(response.content);
            const contentParts: ContentPart[] = [...thinkingParts, ...opaqueParts, { type: "text", text }];
            return { role: "ai", content: contentParts };
        } catch (error) {
            this.logAssistantApiError(logger, error, { phase: "invoke" });
            throw error;
        }
    }

    /** Run the agent and return a stream of incremental response chunks. */
    async stream(
        messages: AgentMessage[],
        threadId: string,
        userId: string,
        signal?: AbortSignal,
    ): Promise<AsyncIterable<AgentStreamChunk>> {
        const logger = this.createOperationLogger("stream", { threadId, userId });
        const trimmed = trimBeforeCompaction(messages);
        const opts = { cache_control: { type: "ephemeral" } as const, ...(signal ? { signal } : {}) };
        let langchainStream: AsyncIterable<unknown>;
        try {
            langchainStream = await this.runnableModel.stream(agentMessagesToBaseMessages(trimmed), opts);
        } catch (error) {
            this.logAssistantApiError(logger, error, { phase: "stream_init" });
            throw error;
        }
        const modelName = this.modelName;
        return {
            async *[Symbol.asyncIterator]() {
                const allCitations: RawCitation[] = [];
                const allOpaqueParts: OpaqueContentPart[] = [];
                const reasoningState = new Map<string, AnthropicReasoningBlockState>();
                const reasoningOrderCounter = { value: 0 };
                const streamThinkingIndexByKey = new Map<string, number>();
                let nextThinkingStreamIndex = 0;
                let textStreamIndex: number | null = null;
                let usage: AgentUsage | undefined;
                let chunkIndex = 0;
                const debugApiContentEnabled = isDebugApiContentEnabled();
                try {
                    if (debugApiContentEnabled) {
                        logger.info(
                            {
                                debugApiContent: debugApiContentEnabled,
                            },
                            "stream.debug-gates",
                        );
                    }
                    for await (const chunk of langchainStream) {
                        chunkIndex += 1;
                        const rawChunk = chunk as Record<string, unknown>;
                        const rawContent = rawChunk.content as string | Record<string, unknown>[];

                        if (debugApiContentEnabled) {
                            logger.info(
                                {
                                    chunkIndex,
                                    rawContent,
                                    toolCallChunks: rawChunk.tool_call_chunks,
                                    invalidToolCalls: rawChunk.invalid_tool_calls,
                                },
                                "stream.api-content",
                            );
                        }

                        const textParts = extractTextPartsFromContent(rawContent, reasoningOrderCounter.value);
                        const toolStatus = detectToolStatus(rawChunk);
                        allCitations.push(...extractCitations(rawContent));
                        allOpaqueParts.push(...extractCompactionBlocks(rawContent));
                        collectReasoningBlocks(rawContent, reasoningState, reasoningOrderCounter);
                        reasoningOrderCounter.value += 1;

                        // Capture token usage from the final chunk's usage_metadata.
                        // Multiple chunks may carry usage_metadata; keep the one with
                        // the highest input_tokens (the real totals, not partial zeros).
                        const usageMeta = rawChunk.usage_metadata as
                            | {
                                  input_tokens?: number;
                                  output_tokens?: number;
                                  input_token_details?: { cache_creation?: number; cache_read?: number };
                              }
                            | undefined;
                        if (
                            usageMeta &&
                            typeof usageMeta.input_tokens === "number" &&
                            usageMeta.input_tokens > (usage?.inputTokens ?? 0)
                        ) {
                            const details = usageMeta.input_token_details;
                            usage = {
                                vendor: "anthropic",
                                model: modelName,
                                inputTokens: usageMeta.input_tokens,
                                outputTokens: usageMeta.output_tokens ?? 0,
                                ...(details?.cache_creation
                                    ? { cacheCreationInputTokens: details.cache_creation }
                                    : {}),
                                ...(details?.cache_read ? { cacheReadInputTokens: details.cache_read } : {}),
                            };
                        }

                        // Emit status chunk before text so the gateway can inject a separator.
                        if (toolStatus) {
                            yield { type: "status" as const, status: toolStatus.code, statusText: toolStatus.text };
                        }

                        for (const textPart of textParts) {
                            if (textPart.partType === "thinking") {
                                const key =
                                    textPart.reasoningKey ??
                                    `thinking:stream:${String(reasoningOrderCounter.value)}:${String(nextThinkingStreamIndex)}`;
                                const partIndex =
                                    streamThinkingIndexByKey.get(key) ??
                                    (() => {
                                        const idx = nextThinkingStreamIndex;
                                        streamThinkingIndexByKey.set(key, idx);
                                        nextThinkingStreamIndex += 1;
                                        return idx;
                                    })();
                                yield {
                                    type: "text-delta" as const,
                                    partType: "thinking" as const,
                                    partIndex,
                                    delta: textPart.text,
                                };
                            } else {
                                textStreamIndex ??= nextThinkingStreamIndex;
                                yield {
                                    type: "text-delta" as const,
                                    partType: "text" as const,
                                    partIndex: textStreamIndex,
                                    delta: textPart.text,
                                };
                            }
                        }
                    }
                } catch (error) {
                    logger.error(
                        {
                            phase: "stream_iterate",
                            ...extractAssistantApiErrorDetails(error),
                        },
                        "Assistant API stream failed",
                    );
                    throw error;
                }
                const completeThinkingParts = materializeThinkingParts(reasoningState);
                for (let i = 0; i < completeThinkingParts.length; i++) {
                    const part = completeThinkingParts[i];
                    if (part) {
                        yield { type: "thinking-part" as const, partIndex: i, part };
                    }
                }
                // Yield opaque parts, citations, and usage at end.
                for (let i = 0; i < allOpaqueParts.length; i++) {
                    const part = allOpaqueParts[i];
                    if (part) {
                        yield { type: "opaque-part" as const, partIndex: i, part };
                    }
                }
                const citations = deduplicateCitations(allCitations);
                if (citations.length > 0) {
                    yield { type: "citations" as const, citations };
                }
                if (usage) {
                    yield { type: "usage" as const, usage };
                }
            },
        };
    }

    /** Return the context window size (in tokens) of the underlying model. */
    getContextWindowSize(): number {
        return this.contextWindowSize;
    }

    /**
     * Determine whether the agent should respond in a multi-user thread.
     *
     * When no {@link LangGraphAgentConfig.triageModelName | triageModelName}
     * is configured the agent always responds.  Otherwise a lightweight
     * classifier model decides based on the recent conversation context.
     */
    async shouldRespond(messages: AgentMessage[], threadId: string, memberCount: number): Promise<ShouldRespondResult> {
        const logger = this.createOperationLogger("shouldRespond", { threadId, memberCount });
        if (!this.triageModelName) {
            return { shouldRespond: true };
        }

        if (!this.triageModel) {
            const opts: ConstructorParameters<typeof ChatAnthropic>[0] = {
                model: this.triageModelName,
                temperature: 0,
                maxTokens: 50,
            };
            if (this.triageApiKey) {
                opts.anthropicApiKey = this.triageApiKey;
            }
            this.triageModel = new ChatAnthropic(opts);
        }

        const triageSystemPrompt =
            "You are a classifier deciding whether an AI assistant should respond to the latest message " +
            "in a group conversation. Each human message includes a header line with the sender's name " +
            "and timestamp, for example:\n\n" +
            "[Alice] @ 2026-04-10T14:30+02:00\n\n" +
            "Can you explain how this works?\n\n" +
            'Respond with exactly "YES" or "NO".\n\n' +
            "YES if:\n" +
            "- The message is addressed to the AI/assistant\n" +
            "- The message asks a question not directed at a specific person\n" +
            "- The AI can add meaningful factual or technical value\n" +
            "- No specific human seems to be the intended recipient\n\n" +
            "NO if:\n" +
            "- The message is clearly directed at another human participant\n" +
            "- The message is social/casual chat between humans\n" +
            "- The AI has nothing useful to add";

        const prompt: BaseMessage[] = [new SystemMessage(triageSystemPrompt), ...agentMessagesToBaseMessages(messages)];

        try {
            const response = await this.triageModel.invoke(prompt);
            const text = typeof response.content === "string" ? response.content.trim().toUpperCase() : "";
            const shouldRespond = !text.startsWith("NO");
            return { shouldRespond, reason: text };
        } catch (error) {
            this.logAssistantApiError(logger, error, { phase: "triage" });
            // If triage fails, default to responding.
            return { shouldRespond: true, reason: "triage error — defaulting to respond" };
        }
    }
}
