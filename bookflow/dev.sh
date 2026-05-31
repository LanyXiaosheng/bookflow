#!/usr/bin/env bash
# bookflow/dev.sh — 一键起 db + api + web；./dev.sh stop 收尾
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/.dev"; mkdir -p "$LOG"
PID_API="$LOG/api.pid"
PID_WEB="$LOG/web.pid"

# 加载 .env，让 cargo run 能直接拿到 DATABASE_URL / AI_*
if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
else
  echo "❌ $ROOT/.env 不存在，先复制 .env.example 并填好 AI_* 配置" >&2
  exit 1
fi

cmd="${1:-start}"

stop() {
  for f in "$PID_API" "$PID_WEB"; do
    if [ -f "$f" ]; then
      pid="$(cat "$f")"
      if kill -0 "$pid" 2>/dev/null; then
        echo "→ 停 $(basename "$f") (pid=$pid)"
        kill "$pid" 2>/dev/null || true
      fi
      rm -f "$f"
    fi
  done
  pkill -f "target/debug/bookflow-app" 2>/dev/null || true
  pkill -f "vite.*--strictPort" 2>/dev/null || true
}

wait_url() {
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "✓ $name 就绪"
      return 0
    fi
    sleep 1
  done
  echo "❌ $name 60s 内未就绪" >&2
  return 1
}

start() {
  echo "▸ 1/3 docker postgres"
  ( cd "$ROOT" && docker compose up -d ) >/dev/null
  for _ in $(seq 1 30); do
    docker exec bookflow-postgres pg_isready -U bookflow -d bookflow_dev >/dev/null 2>&1 && break
    sleep 1
  done
  echo "✓ db 健康"

  echo "▸ 2/3 cargo build (debug)"
  ( cd "$ROOT" && DATABASE_URL="$DATABASE_URL" cargo build -p bookflow-app ) >/dev/null

  echo "▸ 3/3 起 api & web"
  ( cd "$ROOT" && DATABASE_URL="$DATABASE_URL" APP_PORT="${APP_PORT:-3000}" \
      AI_PROVIDER="$AI_PROVIDER" AI_BASE_URL="$AI_BASE_URL" AI_API_KEY="$AI_API_KEY" \
      AI_MODEL="$AI_MODEL" AI_TIMEOUT_SECS="${AI_TIMEOUT_SECS:-60}" \
      nohup ./target/debug/bookflow-app >"$LOG/api.log" 2>&1 < /dev/null & echo $! > "$PID_API"
      disown ) || true

  ( cd "$ROOT/web" && nohup pnpm dev --strictPort >"$LOG/web.log" 2>&1 < /dev/null & echo $! > "$PID_WEB"
      disown ) || true

  wait_url "http://localhost:${APP_PORT:-3000}/healthz" "api"
  wait_url "http://localhost:5174" "web"

  echo
  echo "🟢 全部就绪"
  echo "   web    → http://localhost:5174"
  echo "   api    → http://localhost:${APP_PORT:-3000}"
  echo "   logs   → $LOG/{api,web}.log"
  echo "   stop   → ./dev.sh stop"
}

case "$cmd" in
  start) stop; start ;;
  stop)  stop; echo "🛑 已停" ;;
  restart) stop; start ;;
  logs)
    echo "--- api.log (tail) ---"; tail -n 30 "$LOG/api.log" 2>/dev/null || true
    echo "--- web.log (tail) ---"; tail -n 30 "$LOG/web.log" 2>/dev/null || true ;;
  *) echo "用法: $0 {start|stop|restart|logs}"; exit 1 ;;
esac
