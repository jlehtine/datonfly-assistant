import { randomUUID } from "node:crypto";

import { sql, type Kysely, type QueryCreator, type SqlBool } from "kysely";

import type {
    AppendMessageOptions,
    ContentPart,
    CreateThreadOptions,
    IPersistenceProvider,
    ListThreadsOptions,
    LoadMessagesOptions,
    Thread,
    ThreadMember,
    ThreadMemberInfo,
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
                agent_alias: user.agentAlias ?? null,
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

    async updateUser(userId: string, updates: Partial<Pick<User, "agentAlias">>): Promise<User> {
        const values: Record<string, unknown> = {};
        if ("agentAlias" in updates) values.agent_alias = updates.agentAlias ?? null;

        const row = await this.qb
            .updateTable("user")
            .set(values)
            .where("id", "=", userId)
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
            .leftJoin("thread_user_state", (join) =>
                join
                    .onRef("thread_user_state.thread_id", "=", "thread.id")
                    .onRef("thread_user_state.user_id", "=", "thread_member.user_id"),
            )
            .selectAll("thread")
            .select([
                "thread_user_state.archived_at as user_archived_at",
                "thread_user_state.last_read_at as user_last_read_at",
            ])
            .select(
                sql<string>`(
                    select count(*)
                    from dfa.message m
                    where m.thread_id = thread.id
                      and m.author_id is distinct from thread_member.user_id
                      and m.created_at > coalesce(thread_user_state.last_read_at, '1970-01-01T00:00:00Z'::timestamptz)
                )`.as("unread_count"),
            )
            .where("thread_member.user_id", "=", options.userId);

        if (!options.includeArchived) {
            query = query.where((eb) =>
                eb.or([
                    eb("thread_user_state.archived_at", "is", null),
                    // No state row → not archived
                    eb("thread_user_state.user_id", "is", null),
                ]),
            );
        }

        query = query.orderBy("thread.updated_at", "desc").orderBy("thread.id", "asc");

        if (options.offset !== undefined) {
            query = query.offset(options.offset);
        }
        if (options.limit !== undefined) {
            query = query.limit(options.limit);
        }

        const rows = await query.execute();
        return rows.map((row) => ({
            id: row.id,
            title: row.title,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            archivedAt: row.user_archived_at ?? undefined,
            memoryEnabled: row.memory_enabled,
            lastReadAt: row.user_last_read_at ?? undefined,
            unreadCount: parseInt(row.unread_count, 10),
            titleGeneratedAt: row.title_generated_at ?? undefined,
            titleManuallySet: row.title_manually_set,
        }));
    }

    async updateThread(
        threadId: string,
        updates: Partial<Pick<Thread, "title" | "memoryEnabled" | "titleGeneratedAt" | "titleManuallySet">>,
    ): Promise<Thread> {
        const values: Record<string, unknown> = {};
        if (updates.title !== undefined) values.title = updates.title;
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

    async updateThreadUserState(
        threadId: string,
        userId: string,
        updates: { archivedAt?: Date | null; lastReadAt?: Date | null },
    ): Promise<void> {
        const values: Record<string, unknown> = {};
        if ("archivedAt" in updates) values.archived_at = updates.archivedAt ?? null;
        if ("lastReadAt" in updates) values.last_read_at = updates.lastReadAt ?? null;

        await this.qb
            .insertInto("thread_user_state")
            .values({
                user_id: userId,
                thread_id: threadId,
                archived_at: (values.archived_at as Date | null) ?? null,
                last_read_at: (values.last_read_at as Date | null) ?? null,
            })
            .onConflict((oc) => oc.columns(["user_id", "thread_id"]).doUpdateSet(values))
            .execute();
    }

    async autoUnarchiveThread(threadId: string): Promise<void> {
        await this.qb
            .updateTable("thread_user_state")
            .set({ archived_at: null })
            .where("thread_id", "=", threadId)
            .where("archived_at", "is not", null)
            .execute();
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

    async listMembersWithUser(threadId: string): Promise<ThreadMemberInfo[]> {
        const rows = await this.qb
            .selectFrom("thread_member")
            .innerJoin("user", "user.id", "thread_member.user_id")
            .select([
                "thread_member.user_id",
                "thread_member.role",
                "thread_member.joined_at",
                "user.name",
                "user.email",
                "user.avatar_url",
                "user.agent_alias",
            ])
            .where("thread_member.thread_id", "=", threadId)
            .orderBy("thread_member.joined_at", "asc")
            .execute();
        return rows.map((row) => ({
            userId: row.user_id,
            role: row.role,
            joinedAt: row.joined_at,
            name: row.name,
            email: row.email,
            avatarUrl: row.avatar_url ?? undefined,
            agentAlias: row.agent_alias ?? undefined,
        }));
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

    async updateMemberRole(threadId: string, userId: string, role: ThreadMemberRole): Promise<void> {
        await this.qb
            .updateTable("thread_member")
            .set({ role })
            .where("thread_id", "=", threadId)
            .where("user_id", "=", userId)
            .execute();
    }

    // ─── Messages ───

    async appendMessage(options: AppendMessageOptions): Promise<ThreadMessage> {
        const id = options.id ?? randomUUID();
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
                content_at: options.contentAt ?? now,
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
        let query = this.qb
            .selectFrom("message")
            .leftJoin("user", "user.id", "message.author_id")
            .select([
                "message.id",
                "message.thread_id",
                "message.role",
                "message.content",
                "message.author_id",
                "message.created_at",
                "message.content_at",
                "message.metadata",
                "user.name as author_name",
                "user.avatar_url as author_avatar_url",
            ])
            .where("message.thread_id", "=", options.threadId);

        if (options.before) {
            query = query.where("message.content_at", "<", options.before);
        }
        if (options.excludeCompacted) {
            query = query.where(sql<SqlBool>`coalesce(message.metadata->>'compacted', '') != 'true'`);
        }
        if (options.excludeCompactionSummaries) {
            query = query.where(sql<SqlBool>`coalesce(message.metadata->>'compactionSummary', '') != 'true'`);
        }

        query = query.orderBy("message.content_at", "asc");

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const rows = await query.execute();
        return rows.map((row) => ({
            id: row.id,
            threadId: row.thread_id,
            role: row.role,
            content: row.content as ContentPart[],
            authorId: row.author_id,
            authorName: row.author_name ?? null,
            authorAvatarUrl: row.author_avatar_url ?? null,
            createdAt: row.created_at,
            contentAt: row.content_at,
            metadata: row.metadata ?? undefined,
        }));
    }

    async updateMessageMetadata(messageId: string, metadata: Record<string, unknown>): Promise<void> {
        const result = await this.qb
            .updateTable("message")
            .set({
                metadata: sql`coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`,
            })
            .where("id", "=", messageId)
            .executeTakeFirst();
        if (result.numUpdatedRows === 0n) {
            throw new Error(`updateMessageMetadata: message ${messageId} not found`);
        }
    }

    async deleteMessage(messageId: string): Promise<void> {
        await this.qb.deleteFrom("message").where("id", "=", messageId).execute();
    }

    // ─── Search ───

    async searchUsers(query: string, limit = 20): Promise<User[]> {
        // Escape LIKE special characters to prevent wildcard injection
        const escaped = query.replace(/[%_\\]/g, "\\$&");
        const pattern = `%${escaped}%`;

        const rows = await this.qb
            .selectFrom("user")
            .selectAll()
            .where("deleted_at", "is", null)
            .where((eb) => eb.or([eb("name", "ilike", pattern), eb("email", "ilike", pattern)]))
            .orderBy("name", "asc")
            .limit(limit)
            .execute();
        return rows.map(toUser);
    }
}

// ─── Row → Domain Mappers ───

function toUser(row: UserRow): User {
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        avatarUrl: row.avatar_url ?? undefined,
        agentAlias: row.agent_alias ?? undefined,
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
        authorName: null,
        authorAvatarUrl: null,
        createdAt: row.created_at,
        contentAt: row.content_at,
        metadata: row.metadata ?? undefined,
    };
}
