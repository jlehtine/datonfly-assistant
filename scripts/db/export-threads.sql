-- Export one user's solo-owned threads as JSONL on stdout.
--
-- A "solo" thread is one where the user is both the owner and the only
-- member, so no other person's messages or identity ever leave the server —
-- the dfa.user row itself is never exported.
--
-- Usage (from a machine with SSH access to the server, run from the repo root):
--   ssh SERVER 'cd <deploy-dir> && docker compose exec -T postgres \
--       psql -U datonfly -d datonfly -q -v ON_ERROR_STOP=1 -v email=user@example.com' \
--       < scripts/db/export-threads.sql > threads.jsonl
\set ON_ERROR_STOP on

-- psql does not interpolate :'var' inside dollar-quoted strings, so the
-- existence check runs as a plain query rather than a DO $$ ... $$ block.
SELECT EXISTS (SELECT 1 FROM dfa."user" WHERE email = :'email') AS user_found \gset
\if :user_found
\else
\warn No user found with email: :email
SELECT 1/0; -- abort: ON_ERROR_STOP turns this into a non-zero exit
\endif

CREATE TEMP TABLE export_thread_ids AS
SELECT tm.thread_id
FROM dfa.thread_member tm
WHERE tm.user_id = (SELECT id FROM dfa."user" WHERE email = :'email')
  AND tm.role = 'owner'
  AND (SELECT count(*) FROM dfa.thread_member tm2 WHERE tm2.thread_id = tm.thread_id) = 1;

-- thread
COPY (
    SELECT json_build_object(
        '_t', 'thread',
        'id', t.id,
        'title', t.title,
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'memory_enabled', t.memory_enabled,
        'title_generated_at', t.title_generated_at,
        'title_manually_set', t.title_manually_set,
        'agent_container_id', t.agent_container_id
    )
    FROM dfa.thread t
    JOIN export_thread_ids e ON e.thread_id = t.id
) TO STDOUT;

-- thread_member (always exactly one row per thread: the owner themself)
COPY (
    SELECT json_build_object(
        '_t', 'thread_member',
        'user_id', tm.user_id,
        'thread_id', tm.thread_id,
        'role', tm.role,
        'joined_at', tm.joined_at
    )
    FROM dfa.thread_member tm
    JOIN export_thread_ids e ON e.thread_id = tm.thread_id
) TO STDOUT;

-- message
COPY (
    SELECT json_build_object(
        '_t', 'message',
        'id', m.id,
        'thread_id', m.thread_id,
        'role', m.role,
        'content', m.content,
        'author_id', m.author_id,
        'created_at', m.created_at,
        'content_at', m.content_at,
        'metadata', m.metadata,
        'provider_replay_data', m.provider_replay_data
    )
    FROM dfa.message m
    JOIN export_thread_ids e ON e.thread_id = m.thread_id
) TO STDOUT;

-- thread_user_state
COPY (
    SELECT json_build_object(
        '_t', 'thread_user_state',
        'user_id', s.user_id,
        'thread_id', s.thread_id,
        'archived_at', s.archived_at,
        'last_read_at', s.last_read_at
    )
    FROM dfa.thread_user_state s
    JOIN export_thread_ids e ON e.thread_id = s.thread_id
) TO STDOUT;

-- attachment (bytes hex-encoded; agent-originated attachments have uploader_id NULL)
COPY (
    SELECT json_build_object(
        '_t', 'attachment',
        'id', a.id,
        'uploader_id', a.uploader_id,
        'thread_id', a.thread_id,
        'message_id', a.message_id,
        'name', a.name,
        'mime_type', a.mime_type,
        'size', a.size,
        'bytes_hex', encode(a.bytes, 'hex'),
        'created_at', a.created_at,
        'origin', a.origin
    )
    FROM dfa.attachment a
    JOIN export_thread_ids e ON e.thread_id = a.thread_id
) TO STDOUT;

-- thread_topic
COPY (
    SELECT json_build_object(
        '_t', 'thread_topic',
        'id', tt.id,
        'thread_id', tt.thread_id,
        'topic', tt.topic,
        'ordinal', tt.ordinal,
        'generated_at', tt.generated_at,
        'generated_at_message_count', tt.generated_at_message_count
    )
    FROM dfa.thread_topic tt
    JOIN export_thread_ids e ON e.thread_id = tt.thread_id
) TO STDOUT;
