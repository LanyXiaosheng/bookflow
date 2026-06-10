#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-postgres://bookflow:bookflow@localhost:5433/bookflow_dev}"
POSTGRES_USER="${POSTGRES_USER:-bookflow}"
POSTGRES_DB="${POSTGRES_DB:-bookflow_dev}"

echo "▸ starting postgres"
docker compose -f "$ROOT/docker-compose.yml" up -d postgres

echo "▸ waiting for postgres health"
ready=0
for _ in $(seq 1 60); do
  if docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
    pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    echo "✓ postgres ready"
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "postgres did not become ready within 60s" >&2
  exit 1
fi

echo "▸ running migrations"
(
  cd "$ROOT"
  DATABASE_URL="$DATABASE_URL" cargo run -q -p bookflow-app --bin migrate_db
)

echo "▸ seeding demo dataset"
bash "$ROOT/scripts/seed-demo.sh"

echo "✓ bootstrap complete"
