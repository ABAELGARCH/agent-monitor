#!/bin/bash
# ── Agent Monitor — Installer ──────────────────────────────────
# Installs dependencies and configures Claude Code hooks.

set -e

MONITOR_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "========================================"
echo "  Agent Monitor — Installer"
echo "========================================"
echo ""

# 1. Install npm dependencies
echo "[1/3] Installing dependencies..."
cd "$MONITOR_DIR"
npm install --legacy-peer-deps --silent 2>/dev/null
echo "  Done."

# 2. Make scripts executable
echo "[2/3] Setting permissions..."
chmod +x "$MONITOR_DIR/hooks.sh"
chmod +x "$MONITOR_DIR/start.sh"
echo "  Done."

# 3. Configure Claude Code hooks
echo "[3/3] Configuring Claude Code hooks..."

# Read existing settings or create new
if [ -f "$SETTINGS_FILE" ]; then
  EXISTING=$(cat "$SETTINGS_FILE")
else
  mkdir -p "$HOME/.claude"
  EXISTING="{}"
fi

# Use node to merge hooks into settings.json
node -e "
const fs = require('fs');
const settingsPath = '$SETTINGS_FILE';
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}

const monitorDir = '$MONITOR_DIR';

// Hook commands
const startCmd = monitorDir + '/start.sh && ' + monitorDir + '/hooks.sh session_start';
const toolStartCmd = monitorDir + '/hooks.sh tool_start \\\$TOOL_NAME';
const toolEndCmd = monitorDir + '/hooks.sh tool_end \\\$TOOL_NAME';
const sessionEndCmd = monitorDir + '/hooks.sh session_end';

if (!settings.hooks) settings.hooks = {};

// Helper: add a hook to an event, avoiding duplicates
function addHook(event, matcher, command) {
  if (!settings.hooks[event]) settings.hooks[event] = [];

  // Check if agent-monitor hook already exists
  const existing = settings.hooks[event].find(r =>
    r.hooks?.some(h => h.command?.includes('agent-monitor'))
  );
  if (existing) {
    console.log('  Hook already exists for ' + event + ', skipping.');
    return;
  }

  // Find existing rule with matching matcher to append to
  const rule = settings.hooks[event].find(r =>
    (r.matcher === matcher) || (!r.matcher && !matcher)
  );

  if (rule && rule.hooks) {
    rule.hooks.push({ type: 'command', command });
  } else {
    const newRule = { hooks: [{ type: 'command', command }] };
    if (matcher) newRule.matcher = matcher;
    settings.hooks[event].push(newRule);
  }
}

addHook('UserPromptSubmit', '', startCmd);
addHook('PreToolUse', '.*', toolStartCmd);
addHook('PostToolUse', '*', toolEndCmd);
addHook('Stop', '', sessionEndCmd);

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('  Hooks configured in ' + settingsPath);
"

echo ""
echo "========================================"
echo "  Installation complete!"
echo "========================================"
echo ""
echo "  The dashboard auto-opens in Chrome when you start a Claude session."
echo "  Dashboard URL: http://localhost:4200"
echo ""
echo "  Manual start: bash $MONITOR_DIR/start.sh"
echo ""
