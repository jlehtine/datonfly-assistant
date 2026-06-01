import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");

    await s
        .createTable("attachment")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn("uploader_id", "uuid", (col) => col.notNull().references("dfa.user.id").onDelete("cascade"))
        .addColumn("thread_id", "uuid", (col) => col.references("dfa.thread.id").onDelete("cascade"))
        .addColumn("message_id", "uuid", (col) => col.references("dfa.message.id").onDelete("cascade"))
        .addColumn("name", "varchar(500)", (col) => col.notNull())
        .addColumn("mime_type", "varchar(255)", (col) => col.notNull())
        .addColumn("size", "integer", (col) => col.notNull())
        .addColumn("bytes", "bytea", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .execute();

    // Used to find a thread's attachments and to find orphaned (unassociated) ones.
    await s.createIndex("attachment_thread_idx").on("attachment").column("thread_id").execute();
    await s.createIndex("attachment_message_idx").on("attachment").column("message_id").execute();
    await sql`CREATE INDEX attachment_orphan_idx ON dfa.attachment (uploader_id, created_at) WHERE thread_id IS NULL`.execute(
        db,
    );
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").dropTable("attachment").ifExists().execute();
}
