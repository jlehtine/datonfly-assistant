import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

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
    archived_at: Date | null;
    memory_enabled: ColumnType<boolean, boolean | undefined, boolean>;
    title_generated_at: Date | null;
    title_manually_set: ColumnType<boolean, boolean | undefined, boolean>;
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
    role: "human" | "ai";
    content: ColumnType<unknown[], string, never>;
    author_id: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    metadata: ColumnType<Record<string, unknown> | null, string | null | undefined, never>;
}

// ─── Database ───

/** Kysely database schema mapping table names to their definitions. */
export interface Database {
    user: UsersTable;
    thread: ThreadsTable;
    thread_member: ThreadMembersTable;
    message: MessagesTable;
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
