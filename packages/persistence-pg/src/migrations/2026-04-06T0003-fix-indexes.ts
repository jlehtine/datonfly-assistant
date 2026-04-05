import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    // Index on thread_member(thread_id) — needed for listMembers query and
    // efficient ON DELETE CASCADE when a thread is deleted.
    await db.schema.createIndex("thread_member_thread_idx").on("thread_member").column("thread_id").execute();

    // Index on message(author_id) — needed for efficient ON DELETE SET NULL
    // cascade when a user is deleted.
    await db.schema.createIndex("message_author_idx").on("message").column("author_id").execute();

    // Drop redundant thread_member(user_id) index — the composite PK
    // (user_id, thread_id) already covers lookups by user_id.
    await db.schema.dropIndex("thread_member_user_idx").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.createIndex("thread_member_user_idx").on("thread_member").column("user_id").execute();
    await db.schema.dropIndex("message_author_idx").execute();
    await db.schema.dropIndex("thread_member_thread_idx").execute();
}
