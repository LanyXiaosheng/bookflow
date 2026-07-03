#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-bookflow}"
POSTGRES_DB="${POSTGRES_DB:-bookflow_dev}"
DEMO_USER_ID="${DEMO_USER_ID:-00000000-0000-4000-8000-00000000d001}"

echo "▸ clearing existing demo data"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  psql -v ON_ERROR_STOP=1 \
  -v demo_user_id="$DEMO_USER_ID" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" <<'SQL'
DELETE FROM notifications
WHERE user_id = :'demo_user_id';

DELETE FROM user_sessions
WHERE user_id = :'demo_user_id';

DELETE FROM project_reviews
WHERE project_id IN (
    SELECT id FROM projects WHERE user_id = :'demo_user_id'
);

DELETE FROM project_artifacts
WHERE project_id IN (
    SELECT id FROM projects WHERE user_id = :'demo_user_id'
);

DELETE FROM chapters
WHERE project_id IN (
    SELECT id FROM projects WHERE user_id = :'demo_user_id'
);

DELETE FROM projects
WHERE user_id = :'demo_user_id';

DELETE FROM ai_seed_drafts
WHERE user_id = :'demo_user_id';

DELETE FROM seeds
WHERE user_id = :'demo_user_id';

DELETE FROM users
WHERE id = :'demo_user_id';
SQL

bash "$ROOT/scripts/seed-demo.sh"
