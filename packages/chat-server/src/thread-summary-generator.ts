import type { IAgentProvider, IPersistenceProvider } from "@datonfly-assistant/core";

import type { AuditLogger } from "./audit-logger.js";
import { buildAuthorAliases, resolveAttachmentData, threadMessagesToAgentMessages } from "./messages.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

function isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0;
}

/** Callback invoked after the title has been updated in the database. */
export type OnTitleUpdatedFn = (threadId: string, title: string, titleManuallySet: boolean) => void;

/** Configuration for {@link ThreadSummaryGenerator}. */
export interface ThreadSummaryGeneratorConfig {
    /** Persistence provider for reading threads/messages and writing updates. */
    persistence: IPersistenceProvider;
    /** Agent used to generate the title and topics from conversation messages. */
    agent: IAgentProvider;
    /** Called after a title has been persisted so the caller can broadcast the update. */
    onTitleUpdated: OnTitleUpdatedFn;
    /** Optional audit logger for structured audit events. */
    auditLogger?: AuditLogger | undefined;
}

/**
 * Automatically generates and updates a thread's title and topics using an LLM.
 *
 * **Trigger strategy:**
 * - Re-generation when the total message count is a power of two or a power of two plus one.
 * - Re-generation when at least one hour has passed since the last generation.
 * - The title half is skipped (but topics still regenerate) once a thread's title has been
 *   manually set by a user.
 */
export class ThreadSummaryGenerator {
    private readonly persistence: IPersistenceProvider;
    private readonly agent: IAgentProvider;
    private readonly onTitleUpdated: OnTitleUpdatedFn;
    private readonly auditLogger?: AuditLogger | undefined;

    constructor(config: ThreadSummaryGeneratorConfig) {
        this.persistence = config.persistence;
        this.agent = config.agent;
        this.onTitleUpdated = config.onTitleUpdated;
        this.auditLogger = config.auditLogger;
    }

    /**
     * Check whether the thread needs a (re-)generated summary and, if so, generate one.
     *
     * This method is designed to be called in a fire-and-forget fashion after each
     * assistant response. It never throws — errors are logged to stderr.
     */
    async maybeGenerateSummary(threadId: string): Promise<void> {
        try {
            const thread = await this.persistence.getThread(threadId);
            if (!thread) return;

            const messageCount = await this.persistence.countMessages(threadId);
            const now = Date.now();

            const hourElapsed =
                thread.titleGeneratedAt != null && now - thread.titleGeneratedAt.getTime() >= ONE_HOUR_MS;
            const countTrigger = isPowerOfTwo(messageCount) || isPowerOfTwo(messageCount - 1);
            if (!countTrigger && !hourElapsed) return;

            // Full history, not a windowed slice: the default (cache-aligned) generation path
            // carries exactly the messages the last turn carried, which only holds if nothing is
            // trimmed here -- the provider trims to the compaction boundary itself.
            const allMessages = await this.persistence.loadMessages({ threadId });
            const members = await this.persistence.listMembersWithUser(threadId);
            const authorAliases = buildAuthorAliases(members);
            const agentMessages = threadMessagesToAgentMessages(allMessages, authorAliases);
            // Resolved so the cache-aligned path's request is byte-identical to the real turn's
            // (which does resolve them) -- accepted as a minor, not-yet-measured cost on the
            // standalone fallback path, which has no cache to align with anyway.
            await resolveAttachmentData(agentMessages, this.persistence);

            const result = await this.agent.generateThreadSummary(agentMessages, threadId);
            const title = result.title
                .replace(/^["']+|["']+$/g, "")
                .trim()
                .slice(0, 200);
            if (!title) {
                this.auditLogger?.audit("error", "thread-summary.generate.error", {
                    threadId,
                    error: "empty title returned",
                });
                return;
            }

            // Re-check the thread before writing — the user may have manually
            // renamed it while the LLM was generating a title.
            const freshThread = await this.persistence.getThread(threadId);
            if (!freshThread) return;

            await this.persistence.replaceTopics(threadId, result.topics, new Date(), messageCount);

            if (!freshThread.titleManuallySet) {
                await this.persistence.updateThread(threadId, {
                    title,
                    titleGeneratedAt: new Date(),
                });
                this.onTitleUpdated(threadId, title, false);
            }

            this.auditLogger?.audit("info", "thread-summary.generate", {
                threadId,
                topicCount: result.topics.length,
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            this.auditLogger?.audit("error", "thread-summary.generate.error", { threadId, error: message });
        }
    }
}
