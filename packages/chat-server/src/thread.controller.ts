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
    UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import {
    createThreadRequestSchema,
    paginationQuerySchema,
    updateThreadRequestSchema,
    type CreateThreadRequest,
    type IPersistenceProvider,
    type PaginationQuery,
    type Thread,
    type ThreadMessage,
    type UpdateThreadRequest,
    type User,
} from "@datonfly-assistant/core";

import { PERSISTENCE_PROVIDER } from "./constants.js";
import { ResolvedUser } from "./decorators/user.decorator.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";
import { ZodValidationPipe } from "./pipes/zod-validation.pipe.js";

@Controller("datonfly-assistant/threads")
@UseGuards(RequireUserGuard)
export class ThreadController {
    constructor(@Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider) {}

    @Post()
    async create(
        @ResolvedUser() user: User,
        @Body(new ZodValidationPipe(createThreadRequestSchema)) body: CreateThreadRequest,
    ): Promise<Thread> {
        return this.persistence.createThread({
            title: body.title,
            creatorId: user.id,
        });
    }

    @Get()
    async list(@ResolvedUser() user: User, @Query("includeArchived") includeArchivedStr?: string): Promise<Thread[]> {
        const includeArchived = includeArchivedStr === "true";
        return this.persistence.listThreads({ userId: user.id, includeArchived });
    }

    @Get(":id/messages")
    async listMessages(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
        @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
    ): Promise<ThreadMessage[]> {
        const isMember = await this.persistence.isMember(threadId, user.id);
        if (!isMember) {
            throw new ForbiddenException("Not a member of this thread");
        }

        return this.persistence.loadMessages({ threadId, limit: query.limit, before: query.before });
    }

    @Get(":id")
    async getOne(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
    ): Promise<Thread> {
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
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
        @Body(new ZodValidationPipe(updateThreadRequestSchema)) body: UpdateThreadRequest,
    ): Promise<Thread> {
        const role = await this.persistence.getMemberRole(threadId, user.id);
        if (!role) {
            throw new ForbiddenException("Not a member of this thread");
        }
        if (role !== "owner") {
            throw new ForbiddenException("Only the thread owner can update this thread");
        }

        const updates: {
            title?: string;
            archivedAt?: Date | undefined;
            memoryEnabled?: boolean;
            titleManuallySet?: boolean;
        } = {};
        if (body.title !== undefined) {
            updates.title = body.title;
            updates.titleManuallySet = true;
        }
        if (body.memoryEnabled !== undefined) updates.memoryEnabled = body.memoryEnabled;
        if (body.archivedAt !== undefined) {
            updates.archivedAt = body.archivedAt ?? undefined;
        }

        return this.persistence.updateThread(threadId, updates);
    }

    @Delete(":id")
    @HttpCode(204)
    async remove(
        @ResolvedUser() user: User,
        @Param("id", new ZodValidationPipe(z.uuid())) threadId: string,
    ): Promise<void> {
        const role = await this.persistence.getMemberRole(threadId, user.id);
        if (!role) {
            throw new ForbiddenException("Not a member of this thread");
        }
        if (role !== "owner") {
            throw new ForbiddenException("Only the thread owner can delete this thread");
        }

        await this.persistence.deleteThread(threadId);
    }
}
