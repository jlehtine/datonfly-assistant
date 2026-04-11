import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").alterTable("user").addColumn("agent_alias", "varchar(100)").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.withSchema("dfa").alterTable("user").dropColumn("agent_alias").execute();
}
