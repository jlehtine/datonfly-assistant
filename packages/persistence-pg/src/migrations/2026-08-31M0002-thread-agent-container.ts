import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").alterTable("thread").addColumn("agent_container_id", "varchar(200)").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").alterTable("thread").dropColumn("agent_container_id").execute();
}
