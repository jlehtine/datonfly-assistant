-- DEV ONLY. Deletes thread history in the local database.
--
-- With :email set, deletes only that user's owned threads. With :email left
-- empty (''), deletes every thread. Cascades take care of members, messages,
-- attachments, topics and per-user state. Run via clear-threads.sh, not
-- directly.
\set ON_ERROR_STOP on

-- psql does not interpolate :'var' inside dollar-quoted strings, so the
-- existence check runs as a plain query rather than a DO $$ ... $$ block.
SELECT (:'email' = '' OR EXISTS (SELECT 1 FROM dfa."user" WHERE email = :'email')) AS user_found \gset
\if :user_found
\else
\warn No user found with email: :email
SELECT 1/0; -- abort: ON_ERROR_STOP turns this into a non-zero exit
\endif

DELETE FROM dfa.thread
WHERE :'email' = ''
   OR id IN (
       SELECT thread_id
       FROM dfa.thread_member
       WHERE role = 'owner' AND user_id = (SELECT id FROM dfa."user" WHERE email = :'email')
   );
