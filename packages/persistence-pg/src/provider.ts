import { randomUUID } from "node:crypto";

import type { Kysely, QueryCreator } from "kysely";

import type {
    AppendMessageOptions,
    ContentPart,
    CreateThreadOptions,
    IPersistenceProvider,
    ListThreadsOptions,
    LoadMessagesOptions,
    Thread,
    ThreadMember,
    ThreadMemberRole,
    ThreadMessage,
    User,
} from "@datonfly-assistant/core";

import type { Database, MessageRow, ThreadMemberRow, ThreadRow, UserRow } from "./schema.js";

/**
 * {@link IPersistenceProvider} implementation backed by a PostgreSQL database via Kysely.
 *
 * Use {@link createPostgresPersistence} to obtain an initialised instance with
 * migrations applied. Do not instantiate this class directly in application code.
 */
export class PostgresPersistenceProvider implements IPersistenceProvider {
    private readonly qb: QueryCreator<Database>;

    constructor(private readonly db: Kysely<Database>) {
        this.qb = db.withSchema("dfa");
    }

    // ─── Users ───

    async findUserByEmail(email: string): Promise<User | null> {
        const row = await this.qb.selectFrom("user").selectAll().where("email", "=", email).executeTakeFirst();
        return row ? toUser(row) : null;
    }

    async findUserById(id: string): Promise<User | null> {
        const row = await this.qb.selectFrom("user").selectAll().where("id", "=", id).executeTakeFirst();
        return row ? toUser(row) : null;
    }

    async upsertUser(user: Omit<User, "createdAt">): Promise<User> {
        const row = await this.qb
            .insertInto("user")
            .values({
                id: user.id,
                email: user.email,
                name: user.name,
                avatar_url: user.avatarUrl ?? null,
                last_login_at: user.lastLoginAt ?? null,
                deleted_at: user.deletedAt ?? null,
            })
            .onConflict((oc) =>
                oc.column("email").doUpdateSet({
                    name: user.name,
                    avatar_url: user.avatarUrl ?? null,
                    last_login_at: user.lastLoginAt ?? null,
                }),
            )
            .returningAll()
            .executeTakeFirstOrThrow();
        return toUser(row);
    }

    // ─── Threads ───

    async createThread(options: CreateThreadOptions): Promise<Thread> {
        const id = randomUUID();
        const now = new Date();

        return await this.db.transaction().execute(async (tx) => {
            const trx = tx.withSchema("dfa");
            const row = await trx
                .insertInto("thread")
                .values({
                    id,
                    title: options.title,
                    created_at: now,
                    updated_at: now,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await trx
                .insertInto("thread_member")
                .values({
                    user_id: options.creatorId,
                    thread_id: id,
                    role: "owner",
                    joined_at: now,
                })
                .execute();

            return toThread(row);
        });
    }

    async getThread(threadId: string): Promise<Thread | null> {
        const row = await this.qb.selectFrom("thread").selectAll().where("id", "=", threadId).executeTakeFirst();
        return row ? toThread(row) : null;
    }

    async listThreads(options: ListThreadsOptions): Promise<Thread[]> {
        let query = this.qb
            .selectFrom("thread")
            .innerJoin("thread_member", "thread.id", "thread_member.thread_id")
            .selectAll("thread")
            .where("thread_member.user_id", "=", options.userId);

        if (!options.includeArchived) {
            query = query.where("thread.archived_at", "is", null);
        }

        query = query.orderBy("thread.updated_at", "desc").orderBy("thread.id", "asc");

        if (options.offset !== undefined) {
            query = query.offset(options.offset);
        }
        if (options.limit !== undefined) {
            query = query.limit(options.limit);
        }

        const rows = await query.execute();
        return rows.map(toThread);
    }

    async updateThread(
        threadId: string,
        updates: Partial<
            Pick<Thread, "title" | "archivedAt" | "memoryEnabled" | "titleGeneratedAt" | "titleManuallySet">
        >,
    ): Promise<Thread> {
        const values: Record<string, unknown> = {};
        if (updates.title !== undefined) values.title = updates.title;
        if (updates.archivedAt !== undefined) values.archived_at = updates.archivedAt;
        if ("archivedAt" in updates && updates.archivedAt === undefined) values.archived_at = null;
        if (updates.memoryEnabled !== undefined) values.memory_enabled = updates.memoryEnabled;
        if (updates.titleGeneratedAt !== undefined) values.title_generated_at = updates.titleGeneratedAt;
        if ("titleGeneratedAt" in updates && updates.titleGeneratedAt === undefined) values.title_generated_at = null;
        if (updates.titleManuallySet !== undefined) values.title_manually_set = updates.titleManuallySet;
        values.updated_at = new Date();

        const row = await this.qb
            .updateTable("thread")
            .set(values)
            .where("id", "=", threadId)
            .returningAll()
            .executeTakeFirstOrThrow();
        return toThread(row);
    }

    async deleteThread(threadId: string): Promise<void> {
        await this.qb.deleteFrom("thread").where("id", "=", threadId).execute();
    }

    // ─── Membership ───

    async addMember(threadId: string, userId: string, role: ThreadMemberRole): Promise<ThreadMember> {
        const row = await this.qb
            .insertInto("thread_member")
            .values({
                user_id: userId,
                thread_id: threadId,
                role,
                joined_at: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return toThreadMember(row);
    }

    async removeMember(threadId: string, userId: string): Promise<void> {
        await this.qb
            .deleteFrom("thread_member")
            .where("thread_id", "=", threadId)
            .where("user_id", "=", userId)
            .execute();
    }

    async listMembers(threadId: string): Promise<ThreadMember[]> {
        const rows = await this.qb
            .selectFrom("thread_member")
            .selectAll()
            .where("thread_id", "=", threadId)
            .orderBy("joined_at", "asc")
            .execute();
        return rows.map(toThreadMember);
    }

    async isMember(threadId: string, userId: string): Promise<boolean> {
        const row = await this.qb
            .selectFrom("thread_member")
            .select("user_id")
            .where("thread_id", "=", threadId)
            .where("user_id", "=", userId)
            .executeTakeFirst();
        return row !== undefined;
    }

    async getMemberRole(threadId: string, userId: string): Promise<ThreadMemberRole | null> {
        const row = await this.qb
            .selectFrom("thread_member")
            .select("role")
            .where("thread_id", "=", threadId)
            .where("user_id", "=", userId)
            .executeTakeFirst();
        return row?.role ?? null;
    }

    // ─── Messages ───

    async appendMessage(options: AppendMessageOptions): Promise<ThreadMessage> {
        const id = randomUUID();
        const now = new Date();

        const row = await this.qb
            .insertInto("message")
            .values({
                id,
                thread_id: options.threadId,
                role: options.role,
                content: JSON.stringify(options.content),
                author_id: options.authorId,
                created_at: now,
                metadata: options.metadata ? JSON.stringify(options.metadata) : null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Bump thread updated_at
        await this.qb.updateTable("thread").set({ updated_at: now }).where("id", "=", options.threadId).execute();

        return toMessage(row);
    }

    async countMessages(threadId: string): Promise<number> {
        const result = await this.qb
            .selectFrom("message")
            .select(this.db.fn.countAll<string>().as("count"))
            .where("thread_id", "=", threadId)
            .executeTakeFirstOrThrow();
        return parseInt(result.count, 10);
    }

    async loadMessages(options: LoadMessagesOptions): Promise<ThreadMessage[]> {
        let query = this.qb.selectFrom("message").selectAll().where("thread_id", "=", options.threadId);

        if (options.before) {
            query = query.where("created_at", "<", options.before);
        }

        query = query.orderBy("created_at", "asc");

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const rows = await query.execute();
        return rows.map(toMessage);
    }
}

// ─── Row → Domain Mappers ───

function toUser(row: UserRow): User {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        avatarUrl: row.avatar_url ?? undefined,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at ?? undefined,
        deletedAt: row.deleted_at ?? undefined,
    };
}

function toThread(row: ThreadRow): Thread {
    return {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at ?? undefined,
        memoryEnabled: row.memory_enabled,
        titleGeneratedAt: row.title_generated_at ?? undefined,
        titleManuallySet: row.title_manually_set,
    };
}

function toThreadMember(row: ThreadMemberRow): ThreadMember {
    return {
        userId: row.user_id,
        threadId: row.thread_id,
        role: row.role,
        joinedAt: row.joined_at,
    };
}

function toMessage(row: MessageRow): ThreadMessage {
    return {
        id: row.id,
        threadId: row.thread_id,
        role: row.role,
        content: row.content as ContentPart[],
        authorId: row.author_id,
        createdAt: row.created_at,
        metadata: row.metadata ?? undefined,
    };
}
