import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    // Backfill any NULL values left from before the NOT NULL constraint.
    await sql`UPDATE thread SET title_manually_set = false WHERE title_manually_set IS NULL`.execute(db);

    // Ensure the column is NOT NULL (idempotent if already NOT NULL).
    await db.schema
        .alterTable("thread")
        .alterColumn("title_manually_set", (col) => col.setNotNull())
        .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .alterTable("thread")
        .alterColumn("title_manually_set", (col) => col.dropNotNull())
        .execute();
}
