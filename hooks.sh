#!/bin/bash
# ── Agent Monitor Hook Scripts ─────────────────────────────────
# Called by Claude Code hooks. Data arrives via stdin as JSON.
# Usage: hooks.sh <event_type>

MONITOR_URL="${AGENT_MONITOR_URL:-http://localhost:4200}"

# Read JSON from stdin
INPUT=$(cat)

# Extract common fields
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
SESSION_NAME=$(basename "${CWD:-unknown}")

event_type="$1"

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
    send "/api/session" "{\"sessionId\":\"$SESSION_ID\",\"name\":\"$SESSION_NAME\",\"cwd\":\"$CWD\"}"
    ;;
  tool_start)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    send "/api/tool/start" "{\"sessionId\":\"$SESSION_ID\",\"tool\":\"$TOOL_NAME\"}"
    ;;
  tool_end)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    send "/api/tool/end" "{\"sessionId\":\"$SESSION_ID\",\"tool\":\"$TOOL_NAME\"}"
    ;;
  session_end)
    send "/api/session/end" "{\"sessionId\":\"$SESSION_ID\"}"
    ;;
esac

exit 0
