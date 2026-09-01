import { sql, type Kysely } from "kysely";

/**
 * Agent-produced attachments are born already associated with a thread and
 * message, so they never have an uploader; `origin` distinguishes them from
 * user uploads. Existing rows all backfill to `'user'` via the column default.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");

    await s
        .alterTable("attachment")
        .alterColumn("uploader_id", (col) => col.dropNotNull())
        .execute();
    await s
        .alterTable("attachment")
        .addColumn("origin", "varchar(20)", (col) => col.notNull().defaultTo(sql`'user'`))
        .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");

    await s.alterTable("attachment").dropColumn("origin").execute();
    await s
        .alterTable("attachment")
        .alterColumn("uploader_id", (col) => col.setNotNull())
        .execute();
}
