import { randomUUID } from "node:crypto";

import { sql, type Kysely, type QueryCreator } from "kysely";

import type {
    AppendMessageOptions,
    AttachmentData,
    AttachmentRecord,
    ContentPart,
    CreateThreadOptions,
    IPersistenceProvider,
    ListThreadsOptions,
    LoadMessagesOptions,
    SaveAttachmentOptions,
    Thread,
    ThreadMember,
    ThreadMemberInfo,
    ThreadMemberRole,
    ThreadMessage,
    ThreadTopic,
    User,
} from "@datonfly-assistant/core";

import type {
    AttachmentRow,
    Database,
    MessageRow,
    ThreadMemberRow,
    ThreadRow,
    ThreadTopicRow,
    UserRow,
} from "./schema.js";

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

        if (options.cursor) {
            const { updatedAt, id } = options.cursor;
            // Seek past the last-seen row in the `(updated_at desc, id asc)` ordering, rather than
            // OFFSET-counting — immune to rows reordering (activity) or being inserted ahead of the
            // cursor while the user pages further.
            query = query.where((eb) =>
                eb.or([
                    eb("thread.updated_at", "<", updatedAt),
                    eb("thread.updated_at", "=", updatedAt).and("thread.id", ">", id),
                ]),
            );
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

    async listTopics(threadId: string): Promise<ThreadTopic[]> {
        const rows = await this.qb
            .selectFrom("thread_topic")
            .selectAll()
            .where("thread_id", "=", threadId)
            .orderBy("ordinal", "asc")
            .execute();
        return rows.map(toThreadTopic);
    }

    async replaceTopics(
        threadId: string,
        topics: string[],
        generatedAt: Date,
        generatedAtMessageCount: number,
    ): Promise<ThreadTopic[]> {
        return await this.db.transaction().execute(async (tx) => {
            const trx = tx.withSchema("dfa");
            await trx.deleteFrom("thread_topic").where("thread_id", "=", threadId).execute();
            if (topics.length === 0) return [];

            const rows = await trx
                .insertInto("thread_topic")
                .values(
                    topics.map((topic, ordinal) => ({
                        thread_id: threadId,
                        topic,
                        ordinal,
                        generated_at: generatedAt,
                        generated_at_message_count: generatedAtMessageCount,
                    })),
                )
                .returningAll()
                .execute();
            return rows.map(toThreadTopic);
        });
    }

    async getThreadContainerId(threadId: string): Promise<string | null> {
        const row = await this.qb
            .selectFrom("thread")
            .select("agent_container_id")
            .where("id", "=", threadId)
            .executeTakeFirst();
        return row?.agent_container_id ?? null;
    }

    async setThreadContainerId(threadId: string, containerId: string): Promise<void> {
        // Deliberately doesn't bump `updated_at` — this is provider-internal
        // bookkeeping, not user-visible thread activity.
        await this.qb
            .updateTable("thread")
            .set({ agent_container_id: containerId })
            .where("id", "=", threadId)
            .execute();
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
                provider_replay_data: options.replayData ? JSON.stringify(options.replayData) : null,
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
                "message.provider_replay_data",
                "user.name as author_name",
                "user.avatar_url as author_avatar_url",
            ])
            .where("message.thread_id", "=", options.threadId);

        if (options.before) {
            query = query.where("message.content_at", "<", options.before);
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
            replayData: row.provider_replay_data ?? undefined,
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

    async *loadAllMessages(options?: { batchSize?: number | undefined }): AsyncIterable<ThreadMessage[]> {
        const batchSize = options?.batchSize ?? 100;
        let offset = 0;

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (true) {
            const rows = await this.qb
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
                    "message.provider_replay_data",
                    "user.name as author_name",
                    "user.avatar_url as author_avatar_url",
                ])
                .orderBy("message.created_at", "asc")
                .limit(batchSize)
                .offset(offset)
                .execute();

            if (rows.length === 0) break;

            yield rows.map((row) => ({
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
                replayData: row.provider_replay_data ?? undefined,
            }));

            offset += rows.length;
            if (rows.length < batchSize) break;
        }
    }

    async listThreadIds(userId: string): Promise<string[]> {
        const rows = await this.qb
            .selectFrom("thread_member")
            .select("thread_id")
            .where("user_id", "=", userId)
            .execute();
        return rows.map((row) => row.thread_id);
    }

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

    async searchCoMembers(userId: string, query: string, limit = 20): Promise<User[]> {
        const escaped = query.replace(/[%_\\]/g, "\\$&");
        const pattern = `%${escaped}%`;

        const rows = await this.qb
            .selectFrom("user")
            .selectAll("user")
            .where("user.deleted_at", "is", null)
            .where("user.id", "!=", userId)
            .where((eb) =>
                eb(
                    "user.id",
                    "in",
                    eb
                        .selectFrom("thread_member as tm1")
                        .select("tm1.user_id")
                        .innerJoin("thread_member as tm2", "tm1.thread_id", "tm2.thread_id")
                        .where("tm2.user_id", "=", userId)
                        .where("tm1.user_id", "!=", userId),
                ),
            )
            .where((eb) => eb.or([eb("user.name", "ilike", pattern), eb("user.email", "ilike", pattern)]))
            .orderBy("user.name", "asc")
            .limit(limit)
            .execute();
        return rows.map(toUser);
    }

    // ─── Attachments ───

    async saveAttachment(options: SaveAttachmentOptions): Promise<AttachmentRecord> {
        const id = options.id ?? randomUUID();
        const row = await this.qb
            .insertInto("attachment")
            .values({
                id,
                uploader_id: options.uploaderId ?? null,
                thread_id: options.threadId ?? null,
                message_id: options.messageId ?? null,
                name: options.name,
                mime_type: options.mimeType,
                size: options.size,
                bytes: Buffer.from(options.bytes),
                created_at: new Date(),
                origin: options.origin ?? "user",
            })
            .returning([
                "id",
                "uploader_id",
                "thread_id",
                "message_id",
                "name",
                "mime_type",
                "size",
                "created_at",
                "origin",
            ])
            .executeTakeFirstOrThrow();
        return toAttachmentRecord(row);
    }

    async getAttachment(id: string): Promise<AttachmentRecord | null> {
        const row = await this.qb
            .selectFrom("attachment")
            .select([
                "id",
                "uploader_id",
                "thread_id",
                "message_id",
                "name",
                "mime_type",
                "size",
                "created_at",
                "origin",
            ])
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? toAttachmentRecord(row) : null;
    }

    async loadAttachmentData(id: string): Promise<AttachmentData | null> {
        const row = await this.qb.selectFrom("attachment").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) {
            return null;
        }
        return {
            record: toAttachmentRecord(row),
            bytes: new Uint8Array(row.bytes),
        };
    }

    async associateAttachments(
        ids: string[],
        uploaderId: string,
        threadId: string,
        messageId: string,
    ): Promise<number> {
        if (ids.length === 0) {
            return 0;
        }
        const result = await this.qb
            .updateTable("attachment")
            .set({ thread_id: threadId, message_id: messageId })
            .where("id", "in", ids)
            .where("uploader_id", "=", uploaderId)
            .where("thread_id", "is", null)
            .executeTakeFirst();
        return Number(result.numUpdatedRows);
    }

    async deleteAttachment(id: string): Promise<void> {
        await this.qb.deleteFrom("attachment").where("id", "=", id).execute();
    }

    async deleteOrphanAttachments(olderThan: Date): Promise<number> {
        const result = await this.qb
            .deleteFrom("attachment")
            .where("thread_id", "is", null)
            .where("created_at", "<", olderThan)
            .executeTakeFirst();
        return Number(result.numDeletedRows);
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
        replayData: row.provider_replay_data ?? undefined,
    };
}

function toAttachmentRecord(row: Omit<AttachmentRow, "bytes">): AttachmentRecord {
    return {
        id: row.id,
        uploaderId: row.uploader_id,
        threadId: row.thread_id,
        messageId: row.message_id,
        name: row.name,
        mimeType: row.mime_type,
        size: row.size,
        createdAt: row.created_at,
        origin: row.origin as "user" | "agent",
    };
}

function toThreadTopic(row: ThreadTopicRow): ThreadTopic {
    return {
        threadId: row.thread_id,
        topic: row.topic,
        ordinal: row.ordinal,
        generatedAt: row.generated_at,
        generatedAtMessageCount: row.generated_at_message_count,
    };
}
