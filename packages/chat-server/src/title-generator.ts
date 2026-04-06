import type { AgentMessage, IPersistenceProvider, ThreadMessage } from "@datonfly-assistant/core";

import type { AuditLogger } from "./audit-logger.js";
import { threadMessagesToAgentMessages } from "./messages.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const TITLE_MESSAGE_WINDOW = 20;

function isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

/** Callback that generates a thread title from a list of conversation messages. */
export type GenerateTitleFn = (messages: AgentMessage[]) => Promise<string>;

/** Callback invoked after the title has been updated in the database. */
export type OnTitleUpdatedFn = (threadId: string, title: string, titleManuallySet: boolean) => void;

/** Configuration for {@link ThreadTitleGenerator}. */
export interface ThreadTitleGeneratorConfig {
    /** Persistence provider for reading threads/messages and writing updates. */
    persistence: IPersistenceProvider;
    /** Function that invokes the LLM to generate a title from conversation messages. */
    generateTitle: GenerateTitleFn;
    /** Called after a title has been persisted so the caller can broadcast the update. */
    onTitleUpdated: OnTitleUpdatedFn;
    /** Optional audit logger for structured audit events. */
    auditLogger?: AuditLogger | undefined;
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
    private readonly auditLogger?: AuditLogger | undefined;

    constructor(config: ThreadTitleGeneratorConfig) {
        this.persistence = config.persistence;
        this.generateTitle = config.generateTitle;
        this.onTitleUpdated = config.onTitleUpdated;
        this.auditLogger = config.auditLogger;
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

            const agentMessages = threadMessagesToAgentMessages(recentMessages);
            const rawTitle = await this.generateTitle(agentMessages);

            // Clean up the LLM response: strip surrounding quotes and whitespace, truncate.
            const title = rawTitle
                .replace(/^["']+|["']+$/g, "")
                .trim()
                .slice(0, 200);

            if (!title) {
                this.auditLogger?.audit("error", "title.generate.error", {
                    threadId,
                    error: "empty title returned",
                });
                return;
            }

            // Re-check the thread before writing — the user may have manually
            // renamed it while the LLM was generating a title.
            const freshThread = await this.persistence.getThread(threadId);
            if (!freshThread || freshThread.titleManuallySet) return;

            await this.persistence.updateThread(threadId, {
                title,
                titleGeneratedAt: new Date(),
            });

            this.onTitleUpdated(threadId, title, false);
            this.auditLogger?.audit("info", "title.generate", { threadId });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            this.auditLogger?.audit("error", "title.generate.error", { threadId, error: message });
        }
    }
}
