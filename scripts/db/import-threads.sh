#!/usr/bin/env bash
set -euo pipefail

# DEV ONLY. Loads a JSONL dump produced by export-threads.sql into the local
# Compose Postgres, re-attached to the given dev user (default: the first
# fake user). Run a reindex afterwards (POST /datonfly-assistant/admin/reindex)
# — this script only touches Postgres.
#
# Usage: scripts/db/import-threads.sh <dump-file> [target-email]

DUMP_FILE="${1:?Usage: import-threads.sh <dump-file> [target-email]}"
TARGET_EMAIL="${2:-fake.alice@dev.invalid}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

psql_exec() {
    docker compose exec -T postgres psql -U datonfly -d datonfly -v ON_ERROR_STOP=1 "$@"
}

echo "Staging $DUMP_FILE for import as $TARGET_EMAIL..."
psql_exec -c "DROP SCHEMA IF EXISTS dfa_import CASCADE; CREATE SCHEMA dfa_import; CREATE TABLE dfa_import.raw (line text);"
psql_exec -c "\copy dfa_import.raw FROM STDIN" <"$DUMP_FILE"

echo "Importing..."
psql_exec -v target_email="$TARGET_EMAIL" -f - <"$SCRIPT_DIR/import-threads.sql"

echo "Cleaning up staging schema..."
psql_exec -c "DROP SCHEMA IF EXISTS dfa_import CASCADE;"

echo "Done. Remember to trigger a reindex (POST /datonfly-assistant/admin/reindex)."
