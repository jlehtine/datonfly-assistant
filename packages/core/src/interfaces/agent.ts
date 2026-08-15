import type { ContentPart, MessageRole, OpaqueContentPart } from "../types/message.js";
import type { StatusCode } from "../types/status-code.js";
import type { ProviderLogger } from "./logger.js";
import type { ITool } from "./tool.js";

/** The role of an agent message. Extends {@link MessageRole} with any agent-specific roles. */
export type AgentMessageRole = MessageRole | "system";

/** A message in the format used by the agent service API. */
export interface AgentMessage {
    /** The role of the message author. */
    role: AgentMessageRole;
    /** Ordered content parts of the message. */
    content: ContentPart[];
}

/** A URL + title pair for a web-search citation. */
export interface Citation {
    /** The source URL. */
    url: string;
    /** The human-readable title of the source. */
    title: string;
}

/** Token usage statistics returned by the LLM provider. */
export interface AgentUsage {
    /** Vendor identifier (e.g. `"anthropic"`). */
    vendor: string;
    /** Model identifier (e.g. `"claude-sonnet-4-20250514"`). */
    model: string;
    /**
     * Size of the submitted context, in tokens.
     *
     * This is the whole prompt, **including tokens served from a prompt cache**
     * — not just the uncached remainder a provider may report separately. It is
     * compared against the compaction threshold, so under-reporting it silently
     * prevents compaction from ever triggering.
     *
     * Across a multi-turn tool loop, report the largest single turn: the value
     * describes how full the context is, not a running total.
     */
    inputTokens: number;
    /**
     * Number of output tokens generated, summed across every turn of a tool
     * loop. Includes reasoning tokens, which providers bill as output.
     */
    outputTokens: number;
    /** Tokens used to create a new prompt cache entry. */
    cacheCreationInputTokens?: number | undefined;
    /** Tokens read from an existing prompt cache entry. */
    cacheReadInputTokens?: number | undefined;
}

/** A single chunk of streamed agent output. */
export interface TextDeltaChunk {
    type: "text-delta";
    /** Index of the content part this delta belongs to. */
    partIndex: number;
    /** Type of the part receiving this delta. */
    partType: "text" | "thinking";
    /** The new text fragment to append. */
    delta: string;
}

/** A complete thinking content part emitted during the stream. */
export interface ThinkingPartChunk {
    type: "thinking-part";
    /** Index of this part in the final content array. */
    partIndex: number;
    /** The complete thinking part. */
    part: Extract<ContentPart, { type: "thinking" }>;
}

/** A complete opaque content part emitted during the stream (e.g. compaction). */
export interface OpaquePartChunk {
    type: "opaque-part";
    /** Index of this part in the final content array. */
    partIndex: number;
    /** The complete opaque part. */
    part: OpaqueContentPart;
}

/** A transient status update during streaming (e.g. "Running code…"). Not persisted. */
export interface StatusChunk {
    type: "status";
    /** Machine-readable status code for translation lookup. */
    status: StatusCode;
    /** Human-readable English status label. Always included as a fallback. */
    statusText: string;
}

/** Web-search citations collected during the response. Sent with the final chunk. */
export interface CitationsChunk {
    type: "citations";
    citations: Citation[];
}

/** A tool invocation requested by the model, emitted mid-stream before execution. */
export interface ToolCallChunk {
    type: "tool-call";
    /** Identifier correlating this call with its {@link ToolResultChunk}. */
    toolCallId: string;
    /** Name of the tool being invoked. */
    toolName: string;
    /** Arguments passed to the tool. */
    args: Record<string, unknown>;
}

/** The result of a mid-stream tool invocation, emitted after execution. */
export interface ToolResultChunk {
    type: "tool-result";
    /** Identifier of the {@link ToolCallChunk} this result corresponds to. */
    toolCallId: string;
    /** Name of the tool that produced the result. */
    toolName: string;
    /** The value returned by the tool (serialized to a string by the agent). */
    result: unknown;
    /** Whether the tool execution ended in an error. */
    isError?: boolean | undefined;
}

/** Token usage statistics. Only present on the final chunk. */
export interface UsageChunk {
    type: "usage";
    usage: AgentUsage;
}

/** Discriminated union of all streamed agent output chunk types. */
export type AgentStreamChunk =
    | TextDeltaChunk
    | ThinkingPartChunk
    | OpaquePartChunk
    | StatusChunk
    | CitationsChunk
    | ToolCallChunk
    | ToolResultChunk
    | UsageChunk;

/** Result of an agent's decision on whether to respond in a room thread. */
export interface ShouldRespondResult {
    /** Whether the agent should generate a response. */
    shouldRespond: boolean;
    /** Optional human-readable explanation of the decision. */
    reason?: string | undefined;
}

/**
 * Per-call options for {@link IAgentProvider.run} and {@link IAgentProvider.stream}.
 *
 * Tools are supplied per call (rather than bound at construction) so that they
 * can be scoped to a particular workspace, session, or codegen job.
 */
export interface AgentRunOptions {
    /**
     * Custom tools the agent may invoke during this call.
     *
     * When present, the agent runs an agentic tool-calling loop: it executes
     * each requested tool, feeds the result back to the model, and repeats
     * until the model responds without requesting further tools (bounded by the
     * provider's iteration budget).
     */
    tools?: ITool[] | undefined;
    /**
     * System prompt prepended to the conversation for this call.
     *
     * Intended for embedders that drive the agent toward a task (e.g. codegen)
     * without persisting a system message in the thread.
     */
    systemPrompt?: string | undefined;
}

/**
 * Provider-neutral agent configuration.
 *
 * Every provider accepts these fields; anything vendor-specific belongs in the
 * provider's own `providerOptions` bag, so the composition root can assemble
 * most of an agent's configuration without knowing which provider it targets.
 */
export interface AgentConfig {
    /** Model identifier, in whatever form the provider expects. */
    modelName: string;
    /** API key. Providers may fall back to their SDK's own environment variable. */
    apiKey?: string | undefined;
    /** Override the provider's API base URL (e.g. to record or replay traffic). */
    baseUrl?: string | undefined;
    /** Sampling temperature. When omitted, the provider/model default is used. */
    temperature?: number | undefined;
    /** Maximum number of tokens in the generated response. */
    maxTokens?: number | undefined;
    /** Context window size of the model in tokens. */
    contextWindowSize?: number | undefined;
    /**
     * Cheaper model used to decide whether the agent should respond in
     * multi-user threads. When omitted the agent always responds.
     */
    triageModelName?: string | undefined;
    /** Maximum number of model turns in a tool-calling loop before aborting. */
    maxToolIterations?: number | undefined;
    /** Tools the agent may invoke on every call, unless a call overrides them. */
    defaultTools?: ITool[] | undefined;
    /** System prompt prepended to every call, unless a call overrides it. */
    defaultSystemPrompt?: string | undefined;
    /** Emit verbose debug logging of streamed API content. */
    debugApiContent?: boolean | undefined;
    /** Logger for provider failures. Defaults to a no-op logger when omitted. */
    logger?: ProviderLogger | undefined;
}

/**
 * What an {@link IAgentProvider} supports.
 *
 * Lets callers adapt to a provider without naming one. Providers report this
 * for the configuration they were constructed with, so a capability that is
 * available but switched off reads as unsupported.
 */
export interface AgentCapabilities {
    /**
     * Where conversation compaction happens.
     *
     * - `"provider"` — the provider compacts internally.
     * - `"none"` — no compaction; the caller is responsible for staying in budget.
     */
    compaction: "provider" | "none";
    /** Provider-side web search is enabled. */
    webSearch: boolean;
    /** Provider-side code execution is enabled. */
    codeExecution: boolean;
    /** The model emits reasoning/thinking content. */
    thinking: boolean;
    /** Attachment kinds the provider accepts. */
    attachments: { images: boolean; pdf: boolean };
}

/**
 * Agent service provider that processes messages and produces responses.
 *
 * Implementations wrap an LLM (or chain/graph) and expose both
 * one-shot and streaming interfaces using the generic {@link AgentMessage}
 * type, independent of any specific LLM framework.
 */
export interface IAgentProvider {
    /**
     * Run the agent and return a complete response message.
     */
    run(
        messages: AgentMessage[],
        threadId: string,
        userId: string,
        signal?: AbortSignal,
        options?: AgentRunOptions,
    ): Promise<AgentMessage>;

    /**
     * Run the agent and return a stream of response chunks.
     */
    stream(
        messages: AgentMessage[],
        threadId: string,
        userId: string,
        signal?: AbortSignal,
        options?: AgentRunOptions,
    ): Promise<AsyncIterable<AgentStreamChunk>>;

    /**
     * Determine whether the agent should respond in a room context.
     *
     * Called only for multi-member threads (2+ members). Single-member
     * threads always receive a response without consulting this method.
     *
     * @param messages - Recent conversation messages (triage context window).
     * @param threadId - The thread to evaluate.
     * @param memberCount - Total number of human members in the thread.
     */
    shouldRespond(messages: AgentMessage[], threadId: string, memberCount: number): Promise<ShouldRespondResult>;

    /** Return the context window size (in tokens) of the underlying model. */
    getContextWindowSize(): number;

    /** What this provider supports, so callers can adapt without naming a vendor. */
    readonly capabilities: AgentCapabilities;
}
