import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

import type { ProviderReplayData } from "@datonfly-assistant/core";

// ─── Table Definitions ───

/** Kysely table definition for the `user` database table. */
export interface UsersTable {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    agent_alias: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    last_login_at: Date | null;
    deleted_at: Date | null;
}

/** Kysely table definition for the `thread` database table. */
export interface ThreadsTable {
    id: string;
    title: string;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
    memory_enabled: ColumnType<boolean, boolean | undefined, boolean>;
    title_generated_at: Date | null;
    title_manually_set: ColumnType<boolean, boolean | undefined, boolean>;
    agent_container_id: string | null;
}

/** Kysely table definition for the `thread_member` database table. */
export interface ThreadMembersTable {
    user_id: string;
    thread_id: string;
    role: "owner" | "member";
    joined_at: ColumnType<Date, Date | undefined, never>;
}

/** Kysely table definition for the `message` database table. */
export interface MessagesTable {
    id: Generated<string>;
    thread_id: string;
    role: "human" | "ai" | "system";
    content: ColumnType<unknown[], string, never>;
    author_id: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    content_at: ColumnType<Date, Date | undefined, never>;
    metadata: ColumnType<Record<string, unknown> | null, string | null | undefined, string | null>;
    /**
     * Provider-native data for verbatim replay of an AI turn (see
     * {@link ProviderReplayData}). Stored separately from `content` so it can
     * be purged independently — e.g. after a retention period — without
     * rewriting the human-facing content.
     */
    provider_replay_data: ColumnType<ProviderReplayData | null, string | null | undefined, string | null>;
}

/** Kysely table definition for the `thread_user_state` database table. */
export interface ThreadUserStateTable {
    user_id: string;
    thread_id: string;
    archived_at: Date | null;
    last_read_at: Date | null;
}

/** Kysely table definition for the `attachment` database table. */
export interface AttachmentsTable {
    id: Generated<string>;
    uploader_id: string | null;
    thread_id: string | null;
    message_id: string | null;
    name: string;
    mime_type: string;
    size: number;
    bytes: ColumnType<Buffer, Buffer, never>;
    created_at: ColumnType<Date, Date | undefined, never>;
    origin: ColumnType<string, string | undefined, never>;
}

// ─── Database ───

/** Kysely database schema mapping table names to their definitions. */
export interface Database {
    user: UsersTable;
    thread: ThreadsTable;
    thread_member: ThreadMembersTable;
    message: MessagesTable;
    thread_user_state: ThreadUserStateTable;
    attachment: AttachmentsTable;
}

// ─── Row Types ───

/** Selected (read) row type for the `user` table. */
export type UserRow = Selectable<UsersTable>;
/** Insertable row type for the `user` table. */
export type NewUser = Insertable<UsersTable>;

/** Selected (read) row type for the `thread` table. */
export type ThreadRow = Selectable<ThreadsTable>;
/** Insertable row type for the `thread` table. */
export type NewThread = Insertable<ThreadsTable>;

/** Selected (read) row type for the `thread_member` table. */
export type ThreadMemberRow = Selectable<ThreadMembersTable>;
/** Insertable row type for the `thread_member` table. */
export type NewThreadMember = Insertable<ThreadMembersTable>;

/** Selected (read) row type for the `message` table. */
export type MessageRow = Selectable<MessagesTable>;
/** Insertable row type for the `message` table. */
export type NewMessage = Insertable<MessagesTable>;

/** Selected (read) row type for the `thread_user_state` table. */
export type ThreadUserStateRow = Selectable<ThreadUserStateTable>;
/** Insertable row type for the `thread_user_state` table. */
export type NewThreadUserState = Insertable<ThreadUserStateTable>;

/** Selected (read) row type for the `attachment` table. */
export type AttachmentRow = Selectable<AttachmentsTable>;
/** Insertable row type for the `attachment` table. */
export type NewAttachment = Insertable<AttachmentsTable>;
