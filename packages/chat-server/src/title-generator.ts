import type { BaseMessage } from "@langchain/core/messages";

import type { IPersistenceProvider, ThreadMessage } from "@datonfly-assistant/core";

import { threadMessagesToBaseMessages } from "./messages.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const TITLE_MESSAGE_WINDOW = 20;

function isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

/** Callback that generates a thread title from a list of conversation messages. */
export type GenerateTitleFn = (messages: BaseMessage[]) => Promise<string>;

/** Callback invoked after the title has been updated in the database. */
export type OnTitleUpdatedFn = (threadId: string, title: string) => void;

/** Configuration for {@link ThreadTitleGenerator}. */
export interface ThreadTitleGeneratorConfig {
    /** Persistence provider for reading threads/messages and writing updates. */
    persistence: IPersistenceProvider;
    /** Function that invokes the LLM to generate a title from conversation messages. */
    generateTitle: GenerateTitleFn;
    /** Called after a title has been persisted so the caller can broadcast the update. */
    onTitleUpdated: OnTitleUpdatedFn;
}

/**
 * Automatically generates and updates thread titles using an LLM.
 *
 * **Trigger strategy:**
 * - Re-generation when the total message count is a power of two or a power of two plus one.
 * - Re-generation when at least one hour has passed since the last generation.
 * - Threads with `titleManuallySet === true` are never auto-titled.
 */
export class ThreadTitleGenerator {
    private readonly persistence: IPersistenceProvider;
    private readonly generateTitle: GenerateTitleFn;
    private readonly onTitleUpdated: OnTitleUpdatedFn;

    constructor(config: ThreadTitleGeneratorConfig) {
        this.persistence = config.persistence;
        this.generateTitle = config.generateTitle;
        this.onTitleUpdated = config.onTitleUpdated;
    }

    /**
     * Check whether the thread needs a (re-)generated title and, if so, generate one.
     *
     * This method is designed to be called in a fire-and-forget fashion after each
     * assistant response. It never throws — errors are logged to stderr.
     */
    async maybeGenerateTitle(threadId: string): Promise<void> {
        try {
            const thread = await this.persistence.getThread(threadId);
            if (!thread) return;

            // Never overwrite a manually-set title.
            if (thread.titleManuallySet) return;

            const messageCount = await this.persistence.countMessages(threadId);
            const now = Date.now();

            const hourElapsed =
                thread.titleGeneratedAt != null && now - thread.titleGeneratedAt.getTime() >= ONE_HOUR_MS;

            const countTrigger = isPowerOfTwo(messageCount) || isPowerOfTwo(messageCount - 1);

            if (!countTrigger && !hourElapsed) return;

            // Load recent messages for context.
            const allMessages = await this.persistence.loadMessages({ threadId });
            const recentMessages: ThreadMessage[] =
                allMessages.length > TITLE_MESSAGE_WINDOW
                    ? allMessages.slice(allMessages.length - TITLE_MESSAGE_WINDOW)
                    : allMessages;

            const baseMessages = threadMessagesToBaseMessages(recentMessages);
            const rawTitle = await this.generateTitle(baseMessages);

            // Clean up the LLM response: strip surrounding quotes and whitespace, truncate.
            const title = rawTitle
                .replace(/^["']+|["']+$/g, "")
                .trim()
                .slice(0, 200);

            if (!title) {
                console.warn(
                    `Title generation returned empty for thread ${threadId}, raw response: ${JSON.stringify(rawTitle)}`,
                );
                return;
            }

            await this.persistence.updateThread(threadId, {
                title,
                titleGeneratedAt: new Date(),
            });

            this.onTitleUpdated(threadId, title);
        } catch (err: unknown) {
            console.error("Title generation failed:", err);
        }
    }
}
