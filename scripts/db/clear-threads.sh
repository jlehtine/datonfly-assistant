#!/usr/bin/env bash
set -euo pipefail

# DEV ONLY. Clears thread history in the local Compose Postgres. With no
# argument, deletes every thread; with an email, deletes only that user's
# owned threads.
#
# Usage: scripts/db/clear-threads.sh [email]

EMAIL="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker compose exec -T postgres psql -U datonfly -d datonfly -v ON_ERROR_STOP=1 -v email="$EMAIL" -f - <"$SCRIPT_DIR/clear-threads.sql"
