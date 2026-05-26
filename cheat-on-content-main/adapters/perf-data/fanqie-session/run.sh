#!/usr/bin/env bash
#
# fanqie-session adapter wrapper
#
# Called by /cheat-retro when state.data_collection=adapter and platform=fanqie.
#
# Strategy: lite mode first (pure HTTP, no Playwright), fallback to full mode.
#
# Usage:
#   bash run.sh <work_id> <video_folder> [<script_path>]
#
# Output: writes report.md INTO the video_folder.
# Exit codes:
#   0 = success (report.md written)
#   1 = login expired or required
#   2 = adapter dependency missing
#   3 = other failure (network, parse error, etc.)

set -uo pipefail

WORK_ID="${1:-}"
VIDEO_FOLDER="${2:-}"
SCRIPT_PATH="${3:-}"

if [[ -z "$WORK_ID" || -z "$VIDEO_FOLDER" ]]; then
  echo "Usage: bash run.sh <work_id> <video_folder> [<script_path>]" >&2
  exit 3
fi

ADAPTER_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

PYTHON=""
PROJECT_ROOT="$( dirname "$( dirname "$( realpath "$VIDEO_FOLDER" )" )" )"
if [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
else
  echo "❌ python3 not found — install Python 3.10+ first" >&2
  exit 2
fi

mkdir -p "$VIDEO_FOLDER"

cd "$PROJECT_ROOT"
export CHEAT_PROJECT_ROOT="$PROJECT_ROOT"
export CHEAT_VIDEOS_DIR="$( dirname "$VIDEO_FOLDER" )"

SCRIPT_ARG=""
if [[ -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]]; then
  SCRIPT_ARG="$SCRIPT_PATH"
fi

# --- Try lite mode first (pure HTTP, zero extra deps) ---
COOKIE_FILE="$PROJECT_ROOT/.auth-fanqie/cookies.txt"
if [[ -f "$COOKIE_FILE" ]]; then
  echo "[fanqie-session] lite mode: fetching work_id=$WORK_ID (pure HTTP)"
  if [[ -n "$SCRIPT_ARG" ]]; then
    "$PYTHON" "$ADAPTER_DIR/review_lite.py" work "$WORK_ID" "$SCRIPT_ARG" && {
      # Check if report landed
      if [[ -f "$VIDEO_FOLDER/report.md" ]]; then
        echo "✅ report.md written to $VIDEO_FOLDER/report.md (lite mode)"
        exit 0
      fi
      # review_lite writes to auto-named folder, find and move
      LATEST_REPORT=$(find "$( dirname "$VIDEO_FOLDER" )" -name "report.md" -newer "$VIDEO_FOLDER" -type f 2>/dev/null | head -1)
      if [[ -n "$LATEST_REPORT" ]]; then
        cp "$LATEST_REPORT" "$VIDEO_FOLDER/report.md"
        AUTO_DIR=$( dirname "$LATEST_REPORT" )
        [[ -f "$AUTO_DIR/script.txt" ]] && cp "$AUTO_DIR/script.txt" "$VIDEO_FOLDER/script.txt"
        echo "✅ report.md written to $VIDEO_FOLDER/report.md (lite mode)"
        exit 0
      fi
    }
  else
    "$PYTHON" "$ADAPTER_DIR/review_lite.py" work "$WORK_ID" && {
      LATEST_REPORT=$(find "$( dirname "$VIDEO_FOLDER" )" -name "report.md" -newer "$VIDEO_FOLDER" -type f 2>/dev/null | head -1)
      if [[ -n "$LATEST_REPORT" ]]; then
        cp "$LATEST_REPORT" "$VIDEO_FOLDER/report.md"
        AUTO_DIR=$( dirname "$LATEST_REPORT" )
        [[ -f "$AUTO_DIR/script.txt" ]] && cp "$AUTO_DIR/script.txt" "$VIDEO_FOLDER/script.txt"
        echo "✅ report.md written to $VIDEO_FOLDER/report.md (lite mode)"
        exit 0
      fi
    }
  fi
  echo "[fanqie-session] lite mode failed, trying full mode..."
fi

# --- Fallback: full mode (Playwright) ---
if ! "$PYTHON" -c "import playwright" 2>/dev/null; then
  if [[ ! -f "$COOKIE_FILE" ]]; then
    cat >&2 <<EOF
❌ 需要配置 cookie 或安装 Playwright。

方式 A（推荐，零依赖）：
  1. 浏览器打开 fanqienovel.com/main/writer/short-manage
  2. F12 → Network → 刷新 → 点任意 XHR 请求
  3. 复制 Request Headers 里的 Cookie 值
  4. 粘贴到：$COOKIE_FILE

方式 B（Playwright，需 500MB）：
  cd "$PROJECT_ROOT"
  python3 -m venv .venv && source .venv/bin/activate
  pip install playwright>=1.44 && playwright install chromium
  python "$ADAPTER_DIR/crawler.py" login
EOF
    exit 2
  fi
  echo "❌ lite mode 失败且 Playwright 未安装" >&2
  exit 2
fi

if [[ ! -d "$PROJECT_ROOT/.auth-fanqie" ]]; then
  cat >&2 <<EOF
❌ Not logged in to 番茄小说 创作者中心.

First-time login:
  cd "$PROJECT_ROOT" && source .venv/bin/activate
  $PYTHON "$ADAPTER_DIR/crawler.py" login
EOF
  exit 1
fi

echo "[fanqie-session] full mode: fetching work_id=$WORK_ID"
if [[ -n "$SCRIPT_ARG" ]]; then
  "$PYTHON" "$ADAPTER_DIR/review.py" work "$WORK_ID" "$SCRIPT_ARG"
else
  "$PYTHON" "$ADAPTER_DIR/review.py" work "$WORK_ID"
fi

LATEST_REPORT=$(find "$( dirname "$VIDEO_FOLDER" )" -name "report.md" -newer "$VIDEO_FOLDER" -type f 2>/dev/null | head -1)
if [[ -n "$LATEST_REPORT" && "$( dirname "$LATEST_REPORT" )" != "$VIDEO_FOLDER" ]]; then
  cp "$LATEST_REPORT" "$VIDEO_FOLDER/report.md"
  AUTO_DIR=$( dirname "$LATEST_REPORT" )
  [[ -f "$AUTO_DIR/script.txt" ]] && cp "$AUTO_DIR/script.txt" "$VIDEO_FOLDER/script.txt"
  echo "[fanqie-session] moved auto-named output to $VIDEO_FOLDER/"
fi

if [[ ! -f "$VIDEO_FOLDER/report.md" ]]; then
  echo "❌ report.md not produced — see output above for details" >&2
  exit 3
fi

echo "✅ report.md written to $VIDEO_FOLDER/report.md (full mode)"
exit 0
