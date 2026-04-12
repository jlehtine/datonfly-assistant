import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
    // Add content_at column — determines logical ordering of messages.
    // For regular messages it equals created_at; for compaction summaries
    // it is set to the timestamp of the first compacted message.
    await sql`ALTER TABLE dfa.message ADD COLUMN content_at TIMESTAMPTZ`.execute(db);
    await sql`UPDATE dfa.message SET content_at = created_at`.execute(db);
    await sql`ALTER TABLE dfa.message ALTER COLUMN content_at SET NOT NULL`.execute(db);
    await sql`ALTER TABLE dfa.message ALTER COLUMN content_at SET DEFAULT now()`.execute(db);

    // Replace the existing ordering index with one that uses content_at.
    await sql`DROP INDEX IF EXISTS dfa.message_thread_created_idx`.execute(db);
    await sql`CREATE INDEX message_thread_content_at_idx ON dfa.message (thread_id, content_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS dfa.message_thread_content_at_idx`.execute(db);
    await sql`CREATE INDEX message_thread_created_idx ON dfa.message (thread_id, created_at)`.execute(db);
    await sql`ALTER TABLE dfa.message DROP COLUMN content_at`.execute(db);
}
