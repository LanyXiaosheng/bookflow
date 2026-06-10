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
DATABASE_URL="${DATABASE_URL:-postgres://bookflow:bookflow@localhost:5433/bookflow_dev}"
DEMO_USER_ID="${DEMO_USER_ID:-00000000-0000-4000-8000-00000000d001}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@bookflow.local}"
DEMO_PASSWORD="${DEMO_PASSWORD:-Demo123456}"
DEMO_DISPLAY_NAME="${DEMO_DISPLAY_NAME:-Bookflow 演示账号}"
AI_PROVIDER="${AI_PROVIDER:-anthropic}"
AI_BASE_URL="${AI_BASE_URL:-https://api.anthropic.com}"
AI_API_KEY="${AI_API_KEY:-demo-placeholder-key}"
AI_MODEL="${AI_MODEL:-claude-sonnet-4-5}"
AI_IMAGE_MODEL="${AI_IMAGE_MODEL:-gpt-image-2}"
AI_TIMEOUT_SECS="${AI_TIMEOUT_SECS:-60}"

echo "▸ hashing demo password"
DEMO_PASSWORD_HASH="$(
  cd "$ROOT" &&
    DATABASE_URL="$DATABASE_URL" cargo run -q -p bookflow-app --bin hash_password -- "$DEMO_PASSWORD"
)"

echo "▸ seeding demo data into postgres"
docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
  psql -v ON_ERROR_STOP=1 \
  -v demo_user_id="$DEMO_USER_ID" \
  -v demo_email="$DEMO_EMAIL" \
  -v demo_display_name="$DEMO_DISPLAY_NAME" \
  -v demo_password_hash="$DEMO_PASSWORD_HASH" \
  -v ai_provider="$AI_PROVIDER" \
  -v ai_base_url="$AI_BASE_URL" \
  -v ai_api_key="$AI_API_KEY" \
  -v ai_model="$AI_MODEL" \
  -v ai_image_model="$AI_IMAGE_MODEL" \
  -v ai_timeout_secs="$AI_TIMEOUT_SECS" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  < "$ROOT/db/demo-seed.sql"

echo "✓ demo data ready"
echo "  email:    $DEMO_EMAIL"
echo "  password: $DEMO_PASSWORD"
