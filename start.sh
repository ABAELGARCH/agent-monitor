#!/bin/bash
# ── Agent Monitor — Start/Ensure Server ────────────────────────
# Starts the Vite dev server if not already running, then opens the dashboard.

MONITOR_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${AGENT_MONITOR_PORT:-4200}"
PIDFILE="$MONITOR_DIR/.server.pid"
LOG="$MONITOR_DIR/.server.log"

is_running() {
  if [ -f "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  # Also check if port is in use
  lsof -ti:$PORT >/dev/null 2>&1
}

start_server() {
  cd "$MONITOR_DIR"
  nohup npx vite --port $PORT > "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  # Wait for server to be ready
  for i in $(seq 1 10); do
    sleep 1
    if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
      break
    fi
  done
}

open_dashboard() {
  # Only open once per terminal session
  if [ -z "$AGENT_MONITOR_OPENED" ]; then
    open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null
    export AGENT_MONITOR_OPENED=1
  fi
}

if ! is_running; then
  start_server
fi
