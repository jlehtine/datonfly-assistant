import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    await sql`CREATE SCHEMA IF NOT EXISTS dfa`.execute(db);

    const s = db.schema.withSchema("dfa");

    await s
        .createTable("user")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("email", "varchar(320)", (col) => col.notNull().unique())
        .addColumn("name", "varchar(200)", (col) => col.notNull())
        .addColumn("avatar_url", "text")
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("last_login_at", "timestamptz")
        .addColumn("deleted_at", "timestamptz")
        .execute();

    await s
        .createTable("thread")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("title", "varchar(200)", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("updated_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("archived_at", "timestamptz")
        .addColumn("memory_enabled", "boolean", (col) => col.defaultTo(false).notNull())
        .addColumn("title_generated_at", "timestamptz")
        .addColumn("title_manually_set", "boolean", (col) => col.defaultTo(false).notNull())
        .execute();

    await s
        .createTable("thread_member")
        .addColumn("user_id", "uuid", (col) => col.notNull().references("dfa.user.id").onDelete("cascade"))
        .addColumn("thread_id", "uuid", (col) => col.notNull().references("dfa.thread.id").onDelete("cascade"))
        .addColumn("role", "varchar(20)", (col) => col.notNull())
        .addColumn("joined_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addPrimaryKeyConstraint("thread_member_pk", ["user_id", "thread_id"])
        .execute();

    await s
        .createTable("message")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn("thread_id", "uuid", (col) => col.notNull().references("dfa.thread.id").onDelete("cascade"))
        .addColumn("role", "varchar(20)", (col) => col.notNull())
        .addColumn("content", "jsonb", (col) => col.notNull())
        .addColumn("author_id", "uuid", (col) => col.references("dfa.user.id").onDelete("set null"))
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("metadata", "jsonb")
        .execute();

    await s.createIndex("message_thread_created_idx").on("message").columns(["thread_id", "created_at"]).execute();

    await s.createIndex("thread_member_thread_idx").on("thread_member").column("thread_id").execute();

    await s.createIndex("message_author_idx").on("message").column("author_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    const s = db.schema.withSchema("dfa");
    await s.dropTable("message").ifExists().execute();
    await s.dropTable("thread_member").ifExists().execute();
    await s.dropTable("thread").ifExists().execute();
    await s.dropTable("user").ifExists().execute();
    await sql`DROP SCHEMA IF EXISTS dfa`.execute(db);
}
