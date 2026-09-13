import { Controller, Inject, Optional, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import {
    formatLoggedError,
    type IndexDocumentOptions,
    type IPersistenceProvider,
    type ISearchProvider,
} from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { Public } from "./decorators/public.decorator.js";
import { PERSISTENCE_PROVIDER, SEARCH_PROVIDER, SEARCH_TOPIC_INDEXING_ENABLED } from "./constants.js";
import { AdminGuard } from "./guards/admin.guard.js";
import { extractText } from "./messages.js";
import { RateTier } from "./rate-limit/rate-tier.decorator.js";
import { buildThreadTopicDocuments } from "./topic-indexer.js";

@Controller("datonfly-assistant/admin")
@Public()
@UseGuards(AdminGuard)
export class AdminController {
    constructor(
        @Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider,
        @Optional() @Inject(SEARCH_PROVIDER) private readonly searchProvider: ISearchProvider | null,
        @Inject(SEARCH_TOPIC_INDEXING_ENABLED) private readonly searchTopicIndexingEnabled: boolean,
        private readonly auditLogger: AuditLogger,
    ) {}

    @Post("reindex")
    @RateTier("admin")
    async reindex(@Res() res: Response): Promise<void> {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();

        const write = (line: string): void => {
            res.write(`${line}\n`);
        };

        if (!this.searchProvider) {
            write("Error: No search provider configured. Set DF_QDRANT_URL to enable search.");
            res.end();
            return;
        }

        const startTime = Date.now();

        try {
            write('Dropping existing index "messages"...');
            await this.searchProvider.dropIndex("messages");
            write("Index dropped. Collection re-created with current schema.");

            write("Starting reindex...");

            // 5-second progress timer, shared across both passes below.
            let lastReported = 0;
            const timer = setInterval(() => {
                if (lastReported > 0) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    write(`[${String(elapsed)}s] Indexed ${String(lastReported)} documents...`);
                }
            }, 5000);

            try {
                const messages = await this.searchProvider.indexBatch(
                    "messages",
                    this.createMessageDocumentStream(),
                    (i, _s) => {
                        lastReported = i;
                    },
                );
                write(`Messages: indexed ${String(messages.indexed)}, skipped ${String(messages.skipped)}.`);

                write("Indexing thread topics and thread cards...");
                const topics = await this.searchProvider.indexBatch(
                    "messages",
                    this.createTopicDocumentStream(),
                    (i, _s) => {
                        lastReported += i;
                    },
                );
                clearInterval(timer);

                const indexed = messages.indexed + topics.indexed;
                const skipped = messages.skipped + topics.skipped;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                write(
                    `Reindex complete. Indexed: ${String(indexed)}, Skipped: ${String(skipped)}, Elapsed: ${elapsed}s`,
                );
                this.auditLogger.audit("info", "admin.reindex.complete", {
                    indexed,
                    skipped,
                    elapsedMs: Date.now() - startTime,
                });
            } finally {
                clearInterval(timer);
            }
        } catch (error: unknown) {
            const message = formatLoggedError(error);
            write(`Error: ${message}`);
            this.auditLogger.audit("error", "admin.reindex.failed", { error: message });
        }

        res.end();
    }

    private async *createMessageDocumentStream(): AsyncGenerator<IndexDocumentOptions> {
        const threadMemberCache = new Map<string, string[]>();
        // Mirrors the live indexing path in chat.gateway.ts's indexMessage: dense per-message
        // vectors are only a fallback for when there is no other dense channel (topic indexing off).
        const channels = { dense: !this.searchTopicIndexingEnabled, sparse: true };

        for await (const batch of this.persistence.loadAllMessages({ batchSize: 100 })) {
            for (const msg of batch) {
                const text = extractText(msg.content);
                if (!text) continue;

                let memberIds = threadMemberCache.get(msg.threadId);
                if (!memberIds) {
                    const members = await this.persistence.listMembers(msg.threadId);
                    memberIds = members.map((member) => member.userId);
                    threadMemberCache.set(msg.threadId, memberIds);
                }

                yield {
                    id: msg.id,
                    content: text,
                    metadata: {
                        threadId: msg.threadId,
                        role: msg.role,
                        authorId: msg.authorId,
                        createdAt: msg.createdAt.toISOString(),
                        memberIds,
                    },
                    channels,
                };
            }
        }
    }

    /**
     * Second reindex pass: one dense-only point per topic plus one thread-card point per thread,
     * built with the same `buildThreadTopicDocuments` `topic-indexer.ts` uses for incremental
     * updates, so the two can never drift apart in point shape. Plain upsert stream rather than
     * delete-then-insert, since the collection was just dropped and recreated, so there is
     * nothing stale to delete first. Skipped entirely when topic indexing is disabled, matching
     * `ThreadSummaryGenerator`'s own gating.
     */
    private async *createTopicDocumentStream(): AsyncGenerator<IndexDocumentOptions> {
        if (!this.searchTopicIndexingEnabled) return;

        for await (const batch of this.persistence.loadAllThreadsWithTopics({ batchSize: 100 })) {
            for (const thread of batch) {
                yield* buildThreadTopicDocuments(thread);
            }
        }
    }
}
