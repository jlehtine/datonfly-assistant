import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");

    await s
        .createTable("thread_user_state")
        .addColumn("user_id", "uuid", (col) => col.notNull().references("dfa.user.id").onDelete("cascade"))
        .addColumn("thread_id", "uuid", (col) => col.notNull().references("dfa.thread.id").onDelete("cascade"))
        .addColumn("archived_at", "timestamptz")
        .addColumn("last_read_at", "timestamptz")
        .addPrimaryKeyConstraint("thread_user_state_pk", ["user_id", "thread_id"])
        .execute();

    await s.createIndex("thread_user_state_thread_idx").on("thread_user_state").column("thread_id").execute();

    await s.alterTable("thread").dropColumn("archived_at").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");

    await s.alterTable("thread").addColumn("archived_at", "timestamptz").execute();

    await s.dropTable("thread_user_state").ifExists().execute();
}
