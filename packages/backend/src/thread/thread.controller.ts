import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    Inject,
    NotFoundException,
    Param,
    Patch,
    Post,
    Query,
    Req,
} from "@nestjs/common";
import type { Request } from "express";

import type { AuthUser, IPersistenceProvider, Thread, ThreadMessage } from "@verbal-assistant/core";

import { PERSISTENCE_PROVIDER } from "./constants.js";

@Controller("threads")
export class ThreadController {
    constructor(@Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider) {}

    @Post()
    async create(@Req() req: Request, @Body() body: { title?: string }): Promise<Thread> {
        const user = (req as Request & { user: AuthUser }).user;
        const thread = await this.persistence.createThread({
            title: body.title ?? "Conversation",
            creatorId: user.id,
        });
        return thread;
    }

    @Get()
    async list(@Req() req: Request, @Query("includeArchived") includeArchivedStr?: string): Promise<Thread[]> {
        const user = (req as Request & { user: AuthUser }).user;
        const includeArchived = includeArchivedStr === "true";
        return this.persistence.listThreads({ userId: user.id, includeArchived });
    }

    @Get(":id/messages")
    async listMessages(
        @Req() req: Request,
        @Param("id") threadId: string,
        @Query("limit") limitStr?: string,
        @Query("before") beforeStr?: string,
    ): Promise<ThreadMessage[]> {
        const user = (req as Request & { user: AuthUser }).user;

        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException("Not a member of this thread");
        }

        const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
        const before = beforeStr !== undefined ? new Date(beforeStr) : undefined;

        return this.persistence.loadMessages({ threadId, limit, before });
    }

    @Get(":id")
    async getOne(@Req() req: Request, @Param("id") threadId: string): Promise<Thread> {
        const user = (req as Request & { user: AuthUser }).user;

        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException("Not a member of this thread");
        }

        const thread = await this.persistence.getThread(threadId);
        if (!thread) {
            throw new NotFoundException("Thread not found");
        }
        return thread;
    }

    @Patch(":id")
    async update(
        @Req() req: Request,
        @Param("id") threadId: string,
        @Body() body: { title?: string; archivedAt?: string | null; memoryEnabled?: boolean },
    ): Promise<Thread> {
        const user = (req as Request & { user: AuthUser }).user;

        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException("Not a member of this thread");
        }

        const updates: { title?: string; archivedAt?: Date | undefined; memoryEnabled?: boolean } = {};
        if (body.title !== undefined) updates.title = body.title;
        if (body.memoryEnabled !== undefined) updates.memoryEnabled = body.memoryEnabled;
        if (body.archivedAt !== undefined) {
            updates.archivedAt = body.archivedAt === null ? undefined : new Date(body.archivedAt);
        }

        return this.persistence.updateThread(threadId, updates);
    }

    @Delete(":id")
    @HttpCode(204)
    async remove(@Req() req: Request, @Param("id") threadId: string): Promise<void> {
        const user = (req as Request & { user: AuthUser }).user;

        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException("Not a member of this thread");
        }

        await this.persistence.deleteThread(threadId);
    }
}
