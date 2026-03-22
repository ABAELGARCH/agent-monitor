#!/bin/bash
# ── Agent Monitor — Start/Ensure Server + Open Dashboard ──────
# Called by Claude Code UserPromptSubmit hook.
# Starts Vite if not running, opens Chrome once per day.

MONITOR_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${AGENT_MONITOR_PORT:-4200}"
PIDFILE="$MONITOR_DIR/.server.pid"
LOG="$MONITOR_DIR/.server.log"
OPEN_LOCK="$MONITOR_DIR/.opened_today"

is_running() {
  lsof -ti:$PORT >/dev/null 2>&1
}

start_server() {
  cd "$MONITOR_DIR"
  nohup npx vite --port $PORT > "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  # Wait for server to be ready (max 10s)
  for i in $(seq 1 10); do
    sleep 1
    if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
      break
    fi
  done
}

open_dashboard() {
  # Only open Chrome once per day (or if lock file is stale)
  TODAY=$(date +%Y-%m-%d)
  if [ -f "$OPEN_LOCK" ]; then
    LOCK_DATE=$(cat "$OPEN_LOCK" 2>/dev/null)
    if [ "$LOCK_DATE" = "$TODAY" ]; then
      return 0  # Already opened today
    fi
  fi
  echo "$TODAY" > "$OPEN_LOCK"
  open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null || true
}

# 1. Start server if not running
if ! is_running; then
  start_server
fi

# 2. Open dashboard in browser
open_dashboard

exit 0
