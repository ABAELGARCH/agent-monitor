#!/bin/bash
# ── Agent Monitor Hook Scripts ─────────────────────────────────
# These are called by Claude Code hooks to send events to the monitor server.
# Usage: hooks.sh <event_type> [args...]

MONITOR_URL="${AGENT_MONITOR_URL:-http://localhost:4200}"
SESSION_ID="${CLAUDE_SESSION_ID:-$(echo $PPID)}"
SESSION_NAME="${CLAUDE_SESSION_NAME:-$(basename "$PWD")}"

event_type="$1"
shift

send() {
  curl -s -X POST "$MONITOR_URL$1" \
    -H "Content-Type: application/json" \
    -d "$2" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 &
}

case "$event_type" in
  session_start)
    send "/api/session" "{\"sessionId\":\"$SESSION_ID\",\"name\":\"$SESSION_NAME\",\"cwd\":\"$PWD\"}"
    ;;
  tool_start)
    TOOL_NAME="$1"
    send "/api/tool/start" "{\"sessionId\":\"$SESSION_ID\",\"tool\":\"$TOOL_NAME\"}"
    ;;
  tool_end)
    TOOL_NAME="$1"
    send "/api/tool/end" "{\"sessionId\":\"$SESSION_ID\",\"tool\":\"$TOOL_NAME\"}"
    ;;
  waiting)
    send "/api/waiting" "{\"sessionId\":\"$SESSION_ID\"}"
    ;;
  session_end)
    send "/api/session/end" "{\"sessionId\":\"$SESSION_ID\"}"
    ;;
esac
