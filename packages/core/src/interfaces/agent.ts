import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { IterableReadableStream } from "@langchain/core/utils/stream";

import type { ThreadMessage } from "../types/message.js";

/** Result of an agent's decision on whether to respond in a room thread. */
export interface ShouldRespondResult {
    /** Whether the agent should generate a response. */
    shouldRespond: boolean;
    /** Optional human-readable explanation of the decision. */
    reason?: string | undefined;
}

/**
 * Chat agent that processes messages and produces responses.
 *
 * Implementations wrap an LLM (or chain/graph) and expose both
 * one-shot and streaming interfaces.
 */
export interface IChatAgent {
    /**
     * Run the agent and return a complete response.
     */
    run(messages: BaseMessage[], threadId: string, userId: string): Promise<ThreadMessage>;

    /**
     * Run the agent and return a stream of AI message chunks.
     */
    stream(messages: BaseMessage[], threadId: string, userId: string): Promise<IterableReadableStream<AIMessageChunk>>;

    /**
     * Determine whether the agent should respond in a room context.
     * Always returns true for personal threads.
     */
    shouldRespond(messages: BaseMessage[], threadId: string): Promise<ShouldRespondResult>;
}
