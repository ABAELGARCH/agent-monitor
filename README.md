# Agent Monitor

Real-time pixel art dashboard that shows your Claude Code agents working in an office. Each agent gets their own desk, animated character, and progress bar. When Agent Teams are active, agents are organized by department with the boss coordinating from the center.

![Pixel art office with agents working at their desks](public/Screenshot.jpg)

## Install

```bash
git clone https://github.com/ABAELGARCH/agent-monitor.git
cd agent-monitor
npm install --legacy-peer-deps
bash install.sh
```

That's it. The install script:
- Installs dependencies
- Configures Claude Code hooks automatically in `~/.claude/settings.json`

## Usage

The dashboard **auto-starts** when you begin a Claude Code session. Your first prompt triggers the hooks, the server starts, and Chrome opens `http://localhost:4200`.

To start it manually:
```bash
cd agent-monitor
npx vite --port 4200
```

Then open http://localhost:4200

## What you see

- Each Claude Code session = one pixel art character at a desk
- **Typing** when the agent uses Edit/Write
- **Reading** when using Read/Grep/Search
- **Running** when using Bash
- **Delegating** when using SendMessage (Agent Teams)
- **Progress bar** above each agent — fills up as tools complete
- **Hover** any character to see their role, current tool, and team info

## Agent Teams

When you use Claude Code Agent Teams, the dashboard shows:
- **Boss office** (center top) with crown badge
- **Department rooms**: Backend, Frontend, QA, DevOps, Research
- **Team roster** on the left with online/offline status
- **Task board** on the right
- When an agent finishes, they walk to the **salon** to relax

## Requirements

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- `jq` (for parsing hook data) — `brew install jq` on macOS

## How it works

```
Claude Code session
    | (hooks: PreToolUse, PostToolUse, UserPromptSubmit, Stop)
    v
hooks.sh → curl POST → Vite server (port 4200)
    | (WebSocket /ws)
    v
agentBridge.ts → Pixel Agents UI (Canvas 2D)
```

Claude Code hooks fire on every tool call and send JSON events to the local Vite server. The server broadcasts events via WebSocket to the browser dashboard, which renders pixel art characters using the [Pixel Agents](https://github.com/pablodelucca/pixel-agents) engine (MIT).

## Uninstall

Remove the hooks from `~/.claude/settings.json` — delete any lines containing `agent-monitor`.

## Credits

Built on top of [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca (MIT License). Character sprites by [JIK-A-4](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).
