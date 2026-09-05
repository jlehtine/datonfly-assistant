import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");

    await s
        .createTable("thread_topic")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn("thread_id", "uuid", (col) => col.notNull().references("dfa.thread.id").onDelete("cascade"))
        .addColumn("topic", "varchar(500)", (col) => col.notNull())
        .addColumn("ordinal", "integer", (col) => col.notNull())
        .addColumn("generated_at", "timestamptz", (col) => col.notNull())
        .addColumn("generated_at_message_count", "integer", (col) => col.notNull())
        .execute();

    // Used to list a thread's topics (ordered by ordinal) and to replace a whole batch atomically.
    await s
        .createIndex("thread_topic_thread_ordinal_idx")
        .on("thread_topic")
        .columns(["thread_id", "ordinal"])
        .unique()
        .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").dropTable("thread_topic").ifExists().execute();
}
