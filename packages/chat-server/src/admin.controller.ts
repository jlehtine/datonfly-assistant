import { Controller, Inject, Optional, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import type { IPersistenceProvider, ISearchProvider } from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { PERSISTENCE_PROVIDER, SEARCH_PROVIDER } from "./constants.js";
import { AdminGuard } from "./guards/admin.guard.js";
import { extractText } from "./messages.js";

@Controller("datonfly-assistant/admin")
@UseGuards(AdminGuard)
export class AdminController {
    constructor(
        @Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider,
        @Optional() @Inject(SEARCH_PROVIDER) private readonly searchProvider: ISearchProvider | null,
        private readonly auditLogger: AuditLogger,
    ) {}

    @Post("reindex")
    async reindex(@Res() res: Response): Promise<void> {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();

        const write = (line: string): void => {
            res.write(`${line}\n`);
        };

        if (!this.searchProvider) {
            write("Error: No search provider configured. Set QDRANT_URL to enable search.");
            res.end();
            return;
        }

        const startTime = Date.now();

        try {
            write('Dropping existing index "messages"...');
            await this.searchProvider.dropIndex("messages");
            write("Index dropped. Collection re-created with current schema.");

            write("Starting reindex...");

            // Stream all messages from Postgres and convert to IndexDocumentOptions.
            const documentStream = this.createDocumentStream();

            // 5-second progress timer.
            let lastReported = 0;
            const timer = setInterval(() => {
                if (lastReported > 0) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    write(`[${String(elapsed)}s] Indexed ${String(lastReported)} documents...`);
                }
            }, 5000);

            try {
                const { indexed, skipped } = await this.searchProvider.indexBatch(
                    "messages",
                    documentStream,
                    (i, _s) => {
                        lastReported = i;
                    },
                );
                clearInterval(timer);

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
            const message = error instanceof Error ? error.message : String(error);
            write(`Error: ${message}`);
            this.auditLogger.audit("error", "admin.reindex.failed", { error: message });
        }

        res.end();
    }

    private async *createDocumentStream(): AsyncGenerator<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
    }> {
        const threadMemberCache = new Map<string, string[]>();

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
                };
            }
        }
    }
}
