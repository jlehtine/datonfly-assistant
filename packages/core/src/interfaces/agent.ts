import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { IterableReadableStream } from "@langchain/core/utils/stream";

import type { ThreadMessage } from "../types/message.js";

export interface ShouldRespondResult {
    shouldRespond: boolean;
    reason?: string | undefined;
}

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
