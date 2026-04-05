import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

// ─── Table Definitions ───

export interface UsersTable {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    last_login_at: Date | null;
    deleted_at: Date | null;
}

export interface ThreadsTable {
    id: string;
    title: string;
    created_at: ColumnType<Date, Date | undefined, never>;
    updated_at: ColumnType<Date, Date | undefined, Date>;
    archived_at: Date | null;
    memory_enabled: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface ThreadMembersTable {
    user_id: string;
    thread_id: string;
    role: "owner" | "member";
    joined_at: ColumnType<Date, Date | undefined, never>;
}

export interface MessagesTable {
    id: Generated<string>;
    thread_id: string;
    role: "user" | "assistant" | "system";
    content: ColumnType<unknown[], string, never>;
    author_id: string | null;
    created_at: ColumnType<Date, Date | undefined, never>;
    metadata: ColumnType<Record<string, unknown> | null, string | null | undefined, never>;
}

// ─── Database ───

export interface Database {
    user: UsersTable;
    thread: ThreadsTable;
    thread_member: ThreadMembersTable;
    message: MessagesTable;
}

// ─── Row Types ───

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type ThreadRow = Selectable<ThreadsTable>;
export type NewThread = Insertable<ThreadsTable>;

export type ThreadMemberRow = Selectable<ThreadMembersTable>;
export type NewThreadMember = Insertable<ThreadMembersTable>;

export type MessageRow = Selectable<MessagesTable>;
export type NewMessage = Insertable<MessagesTable>;
