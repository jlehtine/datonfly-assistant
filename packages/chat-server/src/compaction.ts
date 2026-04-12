import type { IAgentProvider, IPersistenceProvider, ThreadMessage } from "@datonfly-assistant/core";

import type { AuditLogger } from "./audit-logger.js";
import { buildAuthorAliases, extractText, threadMessagesToAgentMessages } from "./messages.js";

/** Fraction of the context window that triggers compaction. */
const COMPACTION_TRIGGER_RATIO = 0.6;

/** Fraction of the context window we aim to keep after compaction. */
const COMPACTION_TARGET_RATIO = 0.35;

/**
 * Minimum fraction of total content (by chars) that must be included in the
 * compaction slice. Ensures each compaction round does meaningful work rather
 * than nibbling at a few small messages.
 */
const MIN_COMPACTION_CONTENT_RATIO = 0.5;

/** Minimum number of candidate messages required before compaction is attempted. */
const MIN_CANDIDATES = 4;

/**
 * Target compaction factor — the summary should be roughly this fraction of
 * the input length. Included in the summarization prompt as a guideline.
 */
const COMPACTION_FACTOR = 0.25;

/** Minimum interval between compaction runs for the same thread (ms). */
const MIN_COMPACTION_INTERVAL_MS = 60 * 1000;

/** Average characters per token (heuristic for estimating token count). */
const CHARS_PER_TOKEN = 4;

/** Configuration for {@link CompactionService}. */
export interface CompactionServiceConfig {
    /** Main agent provider (used for compaction unless a dedicated one is supplied). */
    agent: IAgentProvider;
    /** Persistence provider for reading/writing messages. */
    persistence: IPersistenceProvider;
    /** Optional dedicated agent provider for generating compaction summaries. */
    compactionAgent?: IAgentProvider | undefined;
    /** Optional audit logger for structured events. */
    auditLogger?: AuditLogger | undefined;
}

/**
 * Background service that compacts chat history when the context window
 * starts filling up.
 *
 * Compaction replaces older messages with a concise LLM-generated summary.
 * Original messages remain in the database (visible to users) but are
 * marked with `metadata.compacted = true` so they are excluded from the
 * agent context. The summary is stored as a new `"system"` role message
 * with `metadata.compactionSummary = true`.
 */
export class CompactionService {
    private readonly agent: IAgentProvider;
    private readonly compactionAgent: IAgentProvider;
    private readonly persistence: IPersistenceProvider;
    private readonly auditLogger?: AuditLogger | undefined;

    /** Threads currently being compacted (prevent concurrent runs). */
    private readonly inProgress = new Set<string>();
    /** Last compaction timestamp per thread (rate limiting). */
    private readonly lastCompactedAt = new Map<string, number>();

    constructor(config: CompactionServiceConfig) {
        this.agent = config.agent;
        this.compactionAgent = config.compactionAgent ?? config.agent;
        this.persistence = config.persistence;
        this.auditLogger = config.auditLogger;
    }

    /**
     * Check whether compaction is needed for a thread and, if so, run it.
     *
     * Designed to be called fire-and-forget after each completed assistant
     * response. Never throws — errors are logged.
     *
     * @param threadId - The thread to evaluate.
     * @param inputTokens - Input token count from the just-completed response.
     */
    async maybeCompact(threadId: string, inputTokens: number): Promise<void> {
        try {
            const contextWindowSize = this.agent.getContextWindowSize();
            const threshold = contextWindowSize * COMPACTION_TRIGGER_RATIO;

            if (inputTokens <= threshold) {
                this.auditLogger?.audit("debug", "compaction.skip", {
                    threadId,
                    reason: `inputTokens ${String(inputTokens)} <= threshold ${String(threshold)}`,
                });
                return;
            }

            // Rate-limit: don't re-compact too frequently.
            const lastRun = this.lastCompactedAt.get(threadId);
            if (lastRun && Date.now() - lastRun < MIN_COMPACTION_INTERVAL_MS) {
                this.auditLogger?.audit("debug", "compaction.skip", {
                    threadId,
                    reason: "rate-limited",
                });
                return;
            }

            // Prevent concurrent compaction for the same thread.
            if (this.inProgress.has(threadId)) {
                this.auditLogger?.audit("debug", "compaction.skip", {
                    threadId,
                    reason: "already in progress",
                });
                return;
            }

            this.inProgress.add(threadId);
            try {
                const didCompact = await this.compact(threadId, contextWindowSize);
                if (didCompact) {
                    this.lastCompactedAt.set(threadId, Date.now());
                }
            } finally {
                this.inProgress.delete(threadId);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            this.auditLogger?.audit("error", "compaction.error", { threadId, error: message });
        }
    }

    /**
     * Execute compaction for a thread.
     *
     * 1. Load all messages.
     * 2. Select the oldest non-compacted messages to compact.
     * 3. Generate a summary via the compaction agent.
     * 4. Insert the summary as a system message.
     * 5. Mark each compacted message in the database.
     *
     * @returns `true` if messages were actually compacted, `false` if skipped.
     */
    private async compact(threadId: string, contextWindowSize: number): Promise<boolean> {
        const allMessages = await this.persistence.loadMessages({ threadId });

        // Identify compactable candidates (not already compacted).
        // Previous compaction summaries ARE included so that each new round
        // produces a rolling summary that builds on earlier ones.
        const candidates: ThreadMessage[] = [];
        for (const msg of allMessages) {
            if (msg.metadata?.compacted === true) continue;
            candidates.push(msg);
        }

        if (candidates.length < MIN_CANDIDATES) {
            this.auditLogger?.audit("debug", "compaction.skip", {
                threadId,
                reason: `only ${String(candidates.length)} candidates, need >=${String(MIN_CANDIDATES)}`,
            });
            return false;
        }

        // Estimate current total token count from candidates.
        const totalChars = candidates.reduce((sum, msg) => sum + estimateMessageChars(msg), 0);
        const targetChars = contextWindowSize * COMPACTION_TARGET_RATIO * CHARS_PER_TOKEN;

        // Determine the compactable slice using a content-ratio boundary:
        // walk from oldest, accumulating chars, until the slice contains at
        // least MIN_COMPACTION_CONTENT_RATIO of total content. Always
        // preserve at least the last two candidates.
        const minSliceChars = totalChars * MIN_COMPACTION_CONTENT_RATIO;
        const maxSliceEnd = candidates.length - 2;
        let sliceEnd = 0;
        let sliceChars = 0;
        for (let i = 0; i < maxSliceEnd; i++) {
            const candidate = candidates[i];
            if (!candidate) break;
            sliceChars += estimateMessageChars(candidate);
            sliceEnd = i + 1;
            if (sliceChars >= minSliceChars) break;
        }

        // Extend to end on an AI message so we don't split mid-exchange.
        while (sliceEnd < maxSliceEnd && candidates[sliceEnd - 1]?.role !== "ai") {
            sliceEnd++;
        }

        const compactableSlice = candidates.slice(0, sliceEnd);

        // Walk from oldest, selecting messages to compact until we're at or below the target.
        const toCompact: ThreadMessage[] = [];
        let removedChars = 0;

        for (const msg of compactableSlice) {
            if (totalChars - removedChars <= targetChars) break;
            toCompact.push(msg);
            removedChars += estimateMessageChars(msg);
        }

        // Extend to end on an AI message so we don't cut off mid-exchange.
        while (toCompact.length < compactableSlice.length && toCompact[toCompact.length - 1]?.role !== "ai") {
            const next = compactableSlice[toCompact.length];
            if (!next) break;
            toCompact.push(next);
            removedChars += estimateMessageChars(next);
        }

        if (toCompact.length === 0) {
            this.auditLogger?.audit("debug", "compaction.skip", {
                threadId,
                reason: `totalChars ${String(totalChars)} already within target ${String(targetChars)}`,
            });
            return false;
        }

        this.auditLogger?.audit("info", "compaction.start", {
            threadId,
            messageCount: toCompact.length,
        });

        // Build the compaction prompt with author aliases.
        const members = await this.persistence.listMembersWithUser(threadId);
        const authorAliases = buildAuthorAliases(members);
        const agentMessages = threadMessagesToAgentMessages(toCompact, authorAliases);

        // Replace the system prompt with a compaction instruction and ensure
        // the conversation ends with a human message (required by Anthropic).
        agentMessages[0] = {
            role: "system",
            content:
                "You are a conversation summarizer. The user will provide a conversation " +
                "history and ask you to summarize it.",
        };

        const inputChars = toCompact.reduce((sum, msg) => sum + estimateMessageChars(msg), 0);
        const targetWords = Math.round((inputChars * COMPACTION_FACTOR) / 5);

        agentMessages.push({
            role: "human",
            content:
                "Summarize the conversation above. Preserve:\n" +
                "- Key topics discussed and conclusions reached\n" +
                "- Decisions made and action items assigned\n" +
                "- Who said what (reference participants by name where relevant)\n" +
                "- Important context needed to continue the conversation\n\n" +
                `Target length: approximately ${String(targetWords)} words ` +
                `(~${String(Math.round(COMPACTION_FACTOR * 100))}% of the original conversation). ` +
                "Be comprehensive but concise. Write in third person narrative form.\n\n" +
                "Write the summary in the same language that is predominantly used in the conversation.",
        });

        const summary = await this.compactionAgent.run(agentMessages, threadId, "system");

        // Insert summary as a system message, positioned at the first compacted
        // message's timestamp so it sorts before the preserved messages.
        const firstCompactedMsg = toCompact[0];
        const lastCompactedMsg = toCompact[toCompact.length - 1];
        if (!firstCompactedMsg || !lastCompactedMsg) return false;
        await this.persistence.appendMessage({
            threadId,
            role: "system",
            content: [{ type: "text", text: summary.content }],
            authorId: null,
            contentAt: firstCompactedMsg.contentAt,
            metadata: {
                compactionSummary: true,
                coversUpTo: lastCompactedMsg.id,
                compactedCount: toCompact.length,
            },
        });

        // Mark original messages as compacted; delete old compaction summaries
        // that were rolled into the new summary (they serve no purpose anymore).
        for (const msg of toCompact) {
            if (msg.metadata?.compactionSummary === true) {
                await this.persistence.deleteMessage(msg.id);
            } else {
                await this.persistence.updateMessageMetadata(msg.id, { compacted: true });
            }
        }

        this.auditLogger?.audit("info", "compaction.complete", {
            threadId,
            compactedCount: toCompact.length,
        });
        return true;
    }
}

/** Estimate the character count of a message (for heuristic token estimation). */
function estimateMessageChars(msg: ThreadMessage): number {
    return extractText(msg.content).length;
}
