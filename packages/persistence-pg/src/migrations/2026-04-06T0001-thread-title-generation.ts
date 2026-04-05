import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable("thread").addColumn("title_generated_at", "timestamptz").execute();

    await db.schema
        .alterTable("thread")
        .addColumn("title_manually_set", "boolean", (col) => col.defaultTo(false).notNull())
        .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable("thread").dropColumn("title_generated_at").execute();
    await db.schema.alterTable("thread").dropColumn("title_manually_set").execute();
}
