import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    await db.schema
        .createTable("user")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("email", "varchar(320)", (col) => col.notNull().unique())
        .addColumn("name", "varchar(200)", (col) => col.notNull())
        .addColumn("avatar_url", "text")
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("last_login_at", "timestamptz")
        .addColumn("deleted_at", "timestamptz")
        .execute();

    await db.schema
        .createTable("thread")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("title", "varchar(200)", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("updated_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("archived_at", "timestamptz")
        .addColumn("memory_enabled", "boolean", (col) => col.defaultTo(false).notNull())
        .execute();

    await db.schema
        .createTable("thread_member")
        .addColumn("user_id", "uuid", (col) => col.notNull().references("user.id").onDelete("cascade"))
        .addColumn("thread_id", "uuid", (col) => col.notNull().references("thread.id").onDelete("cascade"))
        .addColumn("role", "varchar(20)", (col) => col.notNull())
        .addColumn("joined_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addPrimaryKeyConstraint("thread_member_pk", ["user_id", "thread_id"])
        .execute();

    await db.schema
        .createTable("message")
        .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn("thread_id", "uuid", (col) => col.notNull().references("thread.id").onDelete("cascade"))
        .addColumn("role", "varchar(20)", (col) => col.notNull())
        .addColumn("content", "jsonb", (col) => col.notNull())
        .addColumn("author_id", "uuid", (col) => col.references("user.id").onDelete("set null"))
        .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`).notNull())
        .addColumn("metadata", "jsonb")
        .execute();

    await db.schema
        .createIndex("message_thread_created_idx")
        .on("message")
        .columns(["thread_id", "created_at"])
        .execute();

    await db.schema.createIndex("thread_member_user_idx").on("thread_member").column("user_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable("message").ifExists().execute();
    await db.schema.dropTable("thread_member").ifExists().execute();
    await db.schema.dropTable("thread").ifExists().execute();
    await db.schema.dropTable("user").ifExists().execute();
}
