import type { MessageRole } from "../types/message.js";
import type { StatusCode } from "../types/status-code.js";

/** The role of an agent message. Extends {@link MessageRole} with any agent-specific roles. */
export type AgentMessageRole = MessageRole | "system";

/** A message in the format used by the agent service API. */
export interface AgentMessage {
    /** The role of the message author. */
    role: AgentMessageRole;
    /** The text content of the message. */
    content: string;
    /** Web-search citations collected during the response. */
    citations?: Citation[] | undefined;
}

/** A URL + title pair for a web-search citation. */
export interface Citation {
    /** The source URL. */
    url: string;
    /** The human-readable title of the source. */
    title: string;
}

/** A single chunk of streamed agent output. */
export interface AgentStreamChunk {
    /** The text content of this chunk. */
    content: string;
    /** Machine-readable status code for translation lookup. Not persisted. */
    status?: StatusCode | undefined;
    /** Human-readable English status label. Always included alongside {@link status} as a fallback. */
    statusText?: string | undefined;
    /** Web-search citations collected during the response. Sent with the final chunk. */
    citations?: Citation[] | undefined;
}

/** Result of an agent's decision on whether to respond in a room thread. */
export interface ShouldRespondResult {
    /** Whether the agent should generate a response. */
    shouldRespond: boolean;
    /** Optional human-readable explanation of the decision. */
    reason?: string | undefined;
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
    run(messages: AgentMessage[], threadId: string, userId: string, signal?: AbortSignal): Promise<AgentMessage>;

    /**
     * Run the agent and return a stream of response chunks.
     */
    stream(
        messages: AgentMessage[],
        threadId: string,
        userId: string,
        signal?: AbortSignal,
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
}
