import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").alterTable("message").addColumn("provider_replay_data", "jsonb").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").alterTable("message").dropColumn("provider_replay_data").execute();
}
