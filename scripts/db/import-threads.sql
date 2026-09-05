-- DEV ONLY. Transforms JSONL staged in dfa_import.raw (loaded by
-- import-threads.sh) into the real dfa tables, re-attaching every row to a
-- single target user. Source ids are kept as-is (idempotent re-import via
-- ON CONFLICT DO NOTHING); only user references (thread_member.user_id,
-- message.author_id, attachment.uploader_id) are remapped to :target_email,
-- which is safe because the export only ever contains one user's solo
-- threads. Run via import-threads.sh, not directly.
\set ON_ERROR_STOP on

-- psql does not interpolate :'var' inside dollar-quoted strings, so the
-- existence check runs as a plain query rather than a DO $$ ... $$ block.
SELECT EXISTS (SELECT 1 FROM dfa."user" WHERE email = :'target_email') AS user_found \gset
\if :user_found
\else
\warn No user found with email: :target_email
SELECT 1/0; -- abort: ON_ERROR_STOP turns this into a non-zero exit
\endif

-- Parse once so each table's INSERT ... SELECT below stays simple.
CREATE TEMP TABLE import_rows AS
SELECT (line::jsonb) AS doc
FROM dfa_import.raw
WHERE line <> '';

-- thread
INSERT INTO dfa.thread (
    id, title, created_at, updated_at, memory_enabled, title_generated_at, title_manually_set, agent_container_id
)
SELECT
    (doc ->> 'id')::uuid,
    doc ->> 'title',
    (doc ->> 'created_at')::timestamptz,
    (doc ->> 'updated_at')::timestamptz,
    (doc ->> 'memory_enabled')::boolean,
    (doc ->> 'title_generated_at')::timestamptz,
    (doc ->> 'title_manually_set')::boolean,
    doc ->> 'agent_container_id'
FROM import_rows
WHERE doc ->> '_t' = 'thread'
ON CONFLICT (id) DO NOTHING;

-- thread_member (user_id remapped to the target dev user)
INSERT INTO dfa.thread_member (user_id, thread_id, role, joined_at)
SELECT
    (SELECT id FROM dfa."user" WHERE email = :'target_email'),
    (doc ->> 'thread_id')::uuid,
    doc ->> 'role',
    (doc ->> 'joined_at')::timestamptz
FROM import_rows
WHERE doc ->> '_t' = 'thread_member'
ON CONFLICT (user_id, thread_id) DO NOTHING;

-- message (author_id remapped to the target dev user when present; ai/system
-- messages have no author and stay NULL)
INSERT INTO dfa.message (
    id, thread_id, role, content, author_id, created_at, content_at, metadata, provider_replay_data
)
SELECT
    (doc ->> 'id')::uuid,
    (doc ->> 'thread_id')::uuid,
    doc ->> 'role',
    (doc -> 'content'),
    CASE WHEN doc ->> 'author_id' IS NULL THEN NULL ELSE (SELECT id FROM dfa."user" WHERE email = :'target_email') END,
    (doc ->> 'created_at')::timestamptz,
    (doc ->> 'content_at')::timestamptz,
    (doc -> 'metadata'),
    (doc -> 'provider_replay_data')
FROM import_rows
WHERE doc ->> '_t' = 'message'
ON CONFLICT (id) DO NOTHING;

-- thread_user_state
INSERT INTO dfa.thread_user_state (user_id, thread_id, archived_at, last_read_at)
SELECT
    (SELECT id FROM dfa."user" WHERE email = :'target_email'),
    (doc ->> 'thread_id')::uuid,
    (doc ->> 'archived_at')::timestamptz,
    (doc ->> 'last_read_at')::timestamptz
FROM import_rows
WHERE doc ->> '_t' = 'thread_user_state'
ON CONFLICT (user_id, thread_id) DO NOTHING;

-- attachment (uploader_id remapped when present; agent-originated attachments keep uploader_id NULL)
INSERT INTO dfa.attachment (id, uploader_id, thread_id, message_id, name, mime_type, size, bytes, created_at, origin)
SELECT
    (doc ->> 'id')::uuid,
    CASE
        WHEN doc ->> 'uploader_id' IS NULL THEN NULL
        ELSE (SELECT id FROM dfa."user" WHERE email = :'target_email')
    END,
    (doc ->> 'thread_id')::uuid,
    (doc ->> 'message_id')::uuid,
    doc ->> 'name',
    doc ->> 'mime_type',
    (doc ->> 'size')::integer,
    decode(doc ->> 'bytes_hex', 'hex'),
    (doc ->> 'created_at')::timestamptz,
    doc ->> 'origin'
FROM import_rows
WHERE doc ->> '_t' = 'attachment'
ON CONFLICT (id) DO NOTHING;

-- thread_topic
INSERT INTO dfa.thread_topic (id, thread_id, topic, ordinal, generated_at, generated_at_message_count)
SELECT
    (doc ->> 'id')::uuid,
    (doc ->> 'thread_id')::uuid,
    doc ->> 'topic',
    (doc ->> 'ordinal')::integer,
    (doc ->> 'generated_at')::timestamptz,
    (doc ->> 'generated_at_message_count')::integer
FROM import_rows
WHERE doc ->> '_t' = 'thread_topic'
ON CONFLICT (id) DO NOTHING;

SELECT doc ->> '_t' AS table_name, count(*) AS rows_seen FROM import_rows GROUP BY 1 ORDER BY 1;
