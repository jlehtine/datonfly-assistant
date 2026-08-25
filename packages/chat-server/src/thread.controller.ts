import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    Inject,
    NotFoundException,
    Optional,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import {
    ERROR_CODES,
    createThreadRequestSchema,
    paginationQuerySchema,
    threadSearchQuerySchema,
    updateThreadRequestSchema,
    updateThreadUserStateRequestSchema,
    type CreateThreadRequest,
    type IPersistenceProvider,
    type ISearchProvider,
    type PaginationQuery,
    type Thread,
    type ThreadMemberInfo,
    type ThreadMessage,
    type ThreadSearchQuery,
    type UpdateThreadRequest,
    type UpdateThreadUserStateRequest,
    type User,
} from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { ChatGateway } from "./chat.gateway.js";
import { PERSISTENCE_PROVIDER, SEARCH_PROVIDER, SEARCH_RECENCY_HALF_LIFE_DAYS } from "./constants.js";
import { ResolvedUser } from "./decorators/user.decorator.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";
import { ZodValidationPipe } from "./pipes/zod-validation.pipe.js";
import { RateTier } from "./rate-limit/rate-tier.decorator.js";

@Controller("datonfly-assistant/threads")
@UseGuards(RequireUserGuard)
export class ThreadController {
    private readonly decayLambda: number;

    constructor(
        @Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider,
        @Optional() @Inject(SEARCH_PROVIDER) private readonly searchProvider: ISearchProvider | null,
        @Inject(SEARCH_RECENCY_HALF_LIFE_DAYS) recencyHalfLifeDays: number,
        private readonly gateway: ChatGateway,
        private readonly auditLogger: AuditLogger,
    ) {
        this.decayLambda = Math.LN2 / recencyHalfLifeDays;
    }

    @Post()
    async create(
        @ResolvedUser() user: User,
        @Body(new ZodValidationPipe(createThreadRequestSchema)) body: CreateThreadRequest,
    ): Promise<Thread> {
        const thread = await this.persistence.createThread({
            title: body.title,
            creatorId: user.id,
        });
        this.auditLogger.audit("info", "thread.create", { userId: user.id, threadId: thread.id });
        this.gateway.notifyThreadCreated(thread);
        return thread;
    }

    @Get()
    async list(
        @ResolvedUser() user: User,
        @Query("includeArchived") includeArchivedStr?: string,
        @Query("limit") limitStr?: string,
        @Query("offset") offsetStr?: string,
    ): Promise<Thread[]> {
        const includeArchived = includeArchivedStr === "true";
        const limit = limitStr !== undefined ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : undefined;
        const offset = offsetStr !== undefined ? Math.max(parseInt(offsetStr, 10) || 0, 0) : undefined;
        return this.persistence.listThreads({ userId: user.id, includeArchived, limit, offset });
    }

    @Get("search")
    @RateTier("search")
    async search(
        @ResolvedUser() user: User,
        @Query(new ZodValidationPipe(threadSearchQuerySchema)) query: ThreadSearchQuery,
    ): Promise<{
        results: {
            threadId: string;
            title: string;
            updatedAt: string;
            score: number;
            hits: {
                messageId: string;
                createdAt: string;
                snippet: string;
                highlights: [number, number][];
                score: number;
            }[];
        }[];
    }> {
        if (!this.searchProvider) {
            return { results: [] };
        }

        const limit = query.limit ?? 50;
        const groups = await this.searchProvider.search("messages", {
            query: query.q,
            limit: limit * 3,
            filter: { memberUserId: user.id },
        });

        // Apply recency decay per hit: finalScore = score * exp(-λ * days).
        // TODO(search overhaul phase 3): pass `recency` to `search()` instead and delete this
        // app-side decay/sort/dedup step — Qdrant's formula query now does the same thing.
        // Snippets and highlights are already built by the provider (bm25.ts-backed, phase 2), so no
        // further truncation is needed here.
        const now = Date.now();
        const scoredGroups = groups.map((group) => {
            const decayedHits = group.hits
                .map((hit) => {
                    const createdAt = hit.metadata.createdAt as string | undefined;
                    const daysSince = createdAt ? (now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24) : 0;
                    const finalScore = (hit.score ?? 0) * Math.exp(-this.decayLambda * daysSince);
                    return { hit, createdAt, finalScore };
                })
                .sort((a, b) => b.finalScore - a.finalScore);
            return { threadId: group.threadId, decayedHits };
        });
        scoredGroups.sort((a, b) => (b.decayedHits[0]?.finalScore ?? 0) - (a.decayedHits[0]?.finalScore ?? 0));

        // Enrich with thread titles
        const results: {
            threadId: string;
            title: string;
            updatedAt: string;
            score: number;
            hits: {
                messageId: string;
                createdAt: string;
                snippet: string;
                highlights: [number, number][];
                score: number;
            }[];
        }[] = [];
        for (const group of scoredGroups) {
            // Safety net: enforce membership at read time in case index ACL metadata is stale.
            const isMember = await this.persistence.isMember(group.threadId, user.id);
            if (!isMember) continue;

            const thread = await this.persistence.getThread(group.threadId);
            results.push({
                threadId: group.threadId,
                title: thread?.title ?? "Untitled",
                updatedAt: thread?.updatedAt.toISOString() ?? new Date().toISOString(),
                score: Math.round((group.decayedHits[0]?.finalScore ?? 0) * 1000) / 1000,
                hits: group.decayedHits.map((d) => ({
                    messageId: d.hit.id,
                    createdAt: d.createdAt ?? new Date().toISOString(),
                    snippet: d.hit.pageContent,
                    highlights: d.hit.highlights ?? [],
                    score: Math.round(d.finalScore * 1000) / 1000,
                })),
            });

            if (results.length >= limit) break;
        }

        return { results };
    }

    @Get(":id/messages")
    async listMessages(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
        @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
    ): Promise<ThreadMessage[]> {
        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException({ message: "Not a member of this thread", code: ERROR_CODES.not_member });
        }

        const messages = await this.persistence.loadMessages({
            threadId,
            limit: query.limit,
            before: query.before,
        });

        // Strip opaque content parts — they are internal provider data
        // (e.g. compaction blocks) not intended for the client.
        return messages.map((msg) => ({
            ...msg,
            content: msg.content.filter((p) => p.type !== "opaque"),
        }));
    }

    @Get(":id/members")
    async listMembers(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
    ): Promise<ThreadMemberInfo[]> {
        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException({ message: "Not a member of this thread", code: ERROR_CODES.not_member });
        }

        return this.persistence.listMembersWithUser(threadId);
    }

    @Get(":id")
    async getOne(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
    ): Promise<Thread> {
        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException({ message: "Not a member of this thread", code: ERROR_CODES.not_member });
        }

        const thread = await this.persistence.getThread(threadId);
        if (!thread) {
            throw new NotFoundException({ message: "Thread not found", code: ERROR_CODES.thread_not_found });
        }
        return thread;
    }

    @Patch(":id")
    async update(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
        @Body(new ZodValidationPipe(updateThreadRequestSchema)) body: UpdateThreadRequest,
    ): Promise<Thread> {
        const role = await this.persistence.getMemberRole(threadId, user.id);
        if (!role) {
            throw new ForbiddenException({ message: "Not a member of this thread", code: ERROR_CODES.not_member });
        }
        if (role !== "owner") {
            throw new ForbiddenException({
                message: "Only the thread owner can update this thread",
                code: ERROR_CODES.not_thread_owner,
            });
        }

        const updates: {
            title?: string;
            memoryEnabled?: boolean;
            titleManuallySet?: boolean;
        } = {};
        if (body.title !== undefined) {
            updates.title = body.title;
            updates.titleManuallySet = true;
        }
        if (body.memoryEnabled !== undefined) updates.memoryEnabled = body.memoryEnabled;

        const updated = await this.persistence.updateThread(threadId, updates);
        this.auditLogger.audit("info", "thread.update", { userId: user.id, threadId });
        return updated;
    }

    @Patch(":id/my-state")
    @HttpCode(204)
    async updateMyState(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
        @Body(new ZodValidationPipe(updateThreadUserStateRequestSchema)) body: UpdateThreadUserStateRequest,
    ): Promise<void> {
        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException({ message: "Not a member of this thread", code: ERROR_CODES.not_member });
        }

        const updates: { archivedAt?: Date | null; lastReadAt?: Date | null } = {};
        if (body.archivedAt !== undefined) {
            updates.archivedAt = body.archivedAt;
        }
        if (body.lastReadAt !== undefined) {
            updates.lastReadAt = body.lastReadAt;
        }

        await this.persistence.updateThreadUserState(threadId, user.id, updates);
        this.auditLogger.audit("info", "thread.update-user-state", { userId: user.id, threadId });

        // Broadcast to the acting user's other sockets for multi-tab sync.
        this.gateway.emitToUser(user.id, "thread-updated", {
            event: "thread-updated",
            threadId,
            ...(body.archivedAt !== undefined ? { archived: body.archivedAt !== null } : {}),
            ...(body.lastReadAt !== undefined ? { unreadCount: 0 } : {}),
        });
    }

    @Delete(":id")
    @HttpCode(204)
    async remove(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
    ): Promise<void> {
        const role = await this.persistence.getMemberRole(threadId, user.id);
        if (!role) {
            throw new ForbiddenException({ message: "Not a member of this thread", code: ERROR_CODES.not_member });
        }
        if (role !== "owner") {
            throw new ForbiddenException({
                message: "Only the thread owner can delete this thread",
                code: ERROR_CODES.not_thread_owner,
            });
        }

        await this.persistence.deleteThread(threadId);
        this.auditLogger.audit("info", "thread.delete", { userId: user.id, threadId });
    }
}
