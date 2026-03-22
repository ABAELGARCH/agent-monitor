import react from '@vitejs/plugin-react';
import * as crypto from 'crypto';
import * as fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

import { buildAssetIndex, buildFurnitureCatalog } from './shared/assets/build.ts';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from './shared/assets/loader.ts';

// ── Decoded asset cache (invalidated on file change) ─────────────────────────

interface DecodedCache {
  characters: ReturnType<typeof decodeAllCharacters> | null;
  floors: ReturnType<typeof decodeAllFloors> | null;
  walls: ReturnType<typeof decodeAllWalls> | null;
  furniture: ReturnType<typeof decodeAllFurniture> | null;
}

// ── Agent state (shared between hooks API and WebSocket) ─────────────────────

interface TeamMember {
  name: string;
  role: string;
  model?: string;
  responsibilities?: string[];
}

interface TeamConfig {
  teamName: string;
  description: string;
  members: TeamMember[];
  workflow?: { taskAssignment?: string; approvalRequired?: boolean };
}

interface AgentSession {
  id: string;
  name: string;
  cwd: string;
  status: string;
  currentTool: string | null;
  tools: Array<{ name: string; category: string; startedAt: number; input: string }>;
  startedAt: number;
  lastActivity: number;
  character: string;
  toolCount: number;
  progress: number; // 0.0 to 1.0
  isFinished: boolean;
  teamName?: string;
  teamRole?: string;
  teamMemberName?: string;
  isLead?: boolean;
}

interface TaskInfo {
  id: string;
  subject: string;
  status: string;
  owner?: string;
  activeForm?: string;
}

// ── Team state ───────────────────────────────────────────────────────────────
const teams = new Map<string, TeamConfig>();
const tasks = new Map<string, TaskInfo[]>(); // teamName → tasks

const sessions = new Map<string, AgentSession>();
const CHARACTERS = ['blue', 'green', 'red', 'purple', 'orange', 'pink'];
let characterIndex = 0;

function assignCharacter(): string {
  const c = CHARACTERS[characterIndex % CHARACTERS.length];
  characterIndex++;
  return c;
}

function categorizeTool(tool: string): string {
  if (!tool) return 'thinking';
  const t = tool.toLowerCase();
  if (t.includes('write') || t.includes('edit') || t.includes('create') || t.includes('notebookedit'))
    return 'writing';
  if (t.includes('read') || t.includes('glob') || t.includes('grep') || t.includes('search') || t.includes('get'))
    return 'reading';
  if (t.includes('bash') || t.includes('terminal') || t.includes('exec'))
    return 'running';
  if (t.includes('agent') || t.includes('task') || t.includes('send'))
    return 'delegating';
  if (t.includes('browser') || t.includes('playwright') || t.includes('chrome') || t.includes('screenshot'))
    return 'browsing';
  if (t.includes('deploy') || t.includes('railway') || t.includes('netlify'))
    return 'deploying';
  return 'thinking';
}

// ── Team & Task scanning ─────────────────────────────────────────────────────

const TEAMS_DIR = path.join(process.env.HOME || '', '.claude', 'teams');
const TASKS_DIR = path.join(process.env.HOME || '', '.claude', 'tasks');

function scanTeams(): void {
  if (!fs.existsSync(TEAMS_DIR)) return;
  for (const dir of fs.readdirSync(TEAMS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const configPath = path.join(TEAMS_DIR, dir.name, 'config.json');
    if (!fs.existsSync(configPath)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as TeamConfig;
      teams.set(config.teamName, config);
    } catch { /* skip malformed */ }
  }
}

function scanTasks(): void {
  if (!fs.existsSync(TASKS_DIR)) return;
  for (const dir of fs.readdirSync(TASKS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const taskList: TaskInfo[] = [];
    const taskDir = path.join(TASKS_DIR, dir.name);
    for (const file of fs.readdirSync(taskDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const task = JSON.parse(fs.readFileSync(path.join(taskDir, file), 'utf-8')) as TaskInfo;
        taskList.push(task);
      } catch { /* skip */ }
    }
    if (taskList.length > 0) {
      tasks.set(dir.name, taskList);
    }
  }
}

function matchSessionToTeam(session: AgentSession): void {
  // Try to match session name to a team member
  for (const [teamName, config] of teams) {
    for (const member of config.members) {
      // Match by member name in session name (e.g., session name contains "backend-dev")
      if (
        session.name.toLowerCase().includes(member.name.toLowerCase()) ||
        session.id.toLowerCase().includes(member.name.toLowerCase())
      ) {
        session.teamName = teamName;
        session.teamRole = member.role;
        session.teamMemberName = member.name;
        session.isLead = member.role === 'team-lead';
        return;
      }
    }
  }
}

function getTeamsSnapshot(): Record<string, unknown>[] {
  return Array.from(teams.values()).map((t) => ({
    teamName: t.teamName,
    description: t.description,
    members: t.members,
    workflow: t.workflow,
  }));
}

function getTasksSnapshot(): Record<string, TaskInfo[]> {
  const result: Record<string, TaskInfo[]> = {};
  for (const [k, v] of tasks) result[k] = v;
  return result;
}

// Initial scan
scanTeams();
scanTasks();

// ── Browser-mock assets plugin ───────────────────────────────────────────────

function browserMockAssetsPlugin(): Plugin {
  const assetsDir = path.resolve(__dirname, 'public/assets');
  const distAssetsDir = path.resolve(__dirname, 'dist/assets');

  const cache: DecodedCache = { characters: null, floors: null, walls: null, furniture: null };

  function clearCache(): void {
    cache.characters = null;
    cache.floors = null;
    cache.walls = null;
    cache.furniture = null;
  }

  return {
    name: 'browser-mock-assets',
    configureServer(server) {
      const base = server.config.base.replace(/\/$/, '');

      // Catalog & index
      server.middlewares.use(`${base}/assets/furniture-catalog.json`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildFurnitureCatalog(assetsDir)));
      });
      server.middlewares.use(`${base}/assets/asset-index.json`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildAssetIndex(assetsDir)));
      });

      // Pre-decoded sprites
      server.middlewares.use(`${base}/assets/decoded/characters.json`, (_req, res) => {
        cache.characters ??= decodeAllCharacters(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.characters));
      });
      server.middlewares.use(`${base}/assets/decoded/floors.json`, (_req, res) => {
        cache.floors ??= decodeAllFloors(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.floors));
      });
      server.middlewares.use(`${base}/assets/decoded/walls.json`, (_req, res) => {
        cache.walls ??= decodeAllWalls(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.walls));
      });
      server.middlewares.use(`${base}/assets/decoded/furniture.json`, (_req, res) => {
        cache.furniture ??= decodeAllFurniture(assetsDir, buildFurnitureCatalog(assetsDir));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.furniture));
      });

      // Hot-reload on asset file changes
      server.watcher.add(assetsDir);
      server.watcher.on('change', (file) => {
        if (file.startsWith(assetsDir)) {
          console.log(`[browser-mock-assets] Asset changed: ${path.relative(assetsDir, file)}`);
          clearCache();
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    closeBundle() {
      fs.mkdirSync(distAssetsDir, { recursive: true });

      const catalog = buildFurnitureCatalog(assetsDir);
      fs.writeFileSync(path.join(distAssetsDir, 'furniture-catalog.json'), JSON.stringify(catalog));
      fs.writeFileSync(
        path.join(distAssetsDir, 'asset-index.json'),
        JSON.stringify(buildAssetIndex(assetsDir)),
      );
    },
  };
}

// ── Agent Monitor plugin — Hook API + WebSocket ──────────────────────────────

function agentMonitorPlugin(): Plugin {
  let wss: WebSocketServer | null = null;

  function broadcast(data: unknown): void {
    if (!wss) return;
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  function getSessionsSnapshot(): AgentSession[] {
    return Array.from(sessions.values());
  }

  function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve({}); }
      });
    });
  }

  function jsonResponse(res: ServerResponse, data: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  return {
    name: 'agent-monitor',
    configureServer(server) {
      // WebSocket server piggybacks on Vite's HTTP server
      wss = new WebSocketServer({ noServer: true });

      // Handle upgrade for our WebSocket (path: /ws)
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url === '/ws') {
          wss!.handleUpgrade(req, socket, head, (ws) => {
            wss!.emit('connection', ws, req);
          });
        }
      });

      wss.on('connection', (ws) => {
        // Re-scan teams and tasks on each new connection
        scanTeams();
        scanTasks();
        // Match existing sessions to teams
        for (const session of sessions.values()) matchSessionToTeam(session);
        ws.send(JSON.stringify({
          type: 'init',
          sessions: getSessionsSnapshot(),
          teams: getTeamsSnapshot(),
          tasks: getTasksSnapshot(),
        }));
      });

      // Watch teams directory for changes
      if (fs.existsSync(TEAMS_DIR)) {
        fs.watch(TEAMS_DIR, { recursive: true }, () => {
          scanTeams();
          scanTasks();
          for (const session of sessions.values()) matchSessionToTeam(session);
          broadcast({ type: 'teams_update', teams: getTeamsSnapshot(), tasks: getTasksSnapshot() });
        });
      }

      // Watch tasks directory for changes
      if (fs.existsSync(TASKS_DIR)) {
        fs.watch(TASKS_DIR, { recursive: true }, () => {
          scanTasks();
          broadcast({ type: 'tasks_update', tasks: getTasksSnapshot() });
        });
      }

      // Hook API endpoints — IMPORTANT: more specific paths BEFORE less specific
      // (/api/session/done and /api/session/end BEFORE /api/session)

      // Agent finished working (Stop hook) — progress 100%, go to salon
      server.middlewares.use('/api/session/done', async (req, res, next) => {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = body.sessionId as string;
          const session = sessions.get(sessionId);
          if (session) {
            session.progress = 1.0;
            session.isFinished = true;
            session.status = 'idle';
            session.currentTool = null;
            session.lastActivity = Date.now();
            broadcast({ type: 'agent_done', sessionId, progress: 1.0 });
          }
          jsonResponse(res, { ok: true });
        } else { next(); }
      });

      server.middlewares.use('/api/session/end', async (req, res, next) => {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = body.sessionId as string;
          const session = sessions.get(sessionId);
          if (session) {
            session.status = 'done';
            session.lastActivity = Date.now();
            broadcast({ type: 'session_end', sessionId });
            setTimeout(() => {
              sessions.delete(sessionId);
              broadcast({ type: 'session_removed', sessionId });
            }, 30000);
          }
          jsonResponse(res, { ok: true });
        } else { next(); }
      });

      // Create session (must be AFTER /done and /end to avoid prefix match)
      server.middlewares.use('/api/session', async (req, res, next) => {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = (body.sessionId as string) || crypto.randomUUID();
          const name = (body.name as string) || path.basename((body.cwd as string) || 'Claude');
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
              id: sessionId,
              name,
              cwd: (body.cwd as string) || '',
              status: 'idle',
              currentTool: null,
              tools: [],
              startedAt: Date.now(),
              lastActivity: Date.now(),
              character: assignCharacter(),
              toolCount: 0,
              progress: 0,
              isFinished: false,
            });
          }
          matchSessionToTeam(sessions.get(sessionId)!);
          broadcast({ type: 'session_start', session: sessions.get(sessionId) });
          jsonResponse(res, { ok: true, id: sessionId });
        } else { next(); }
      });

      server.middlewares.use('/api/tool/start', async (req, res, next) => {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = body.sessionId as string;
          const tool = body.tool as string;
          const session = sessions.get(sessionId);
          if (session) {
            const toolCategory = categorizeTool(tool);
            session.status = toolCategory;
            session.currentTool = tool;
            session.lastActivity = Date.now();
            session.toolCount++;
            // Progress: logarithmic curve approaching 1.0
            // Each tool adds less — asymptotic: 1 - 1/(1 + count * 0.12)
            session.progress = Math.min(0.95, 1 - 1 / (1 + session.toolCount * 0.12));
            session.isFinished = false;
            session.tools.push({
              name: tool,
              category: toolCategory,
              startedAt: Date.now(),
              input: '',
            });
            if (session.tools.length > 50) session.tools.shift();
            broadcast({ type: 'tool_start', sessionId, tool, category: toolCategory, progress: session.progress });
          }
          jsonResponse(res, { ok: true });
        } else { next(); }
      });

      server.middlewares.use('/api/tool/end', async (req, res, next) => {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = body.sessionId as string;
          const tool = body.tool as string;
          const session = sessions.get(sessionId);
          if (session) {
            session.status = 'idle';
            session.currentTool = null;
            session.lastActivity = Date.now();
            broadcast({ type: 'tool_end', sessionId, tool, progress: session.progress });
          }
          jsonResponse(res, { ok: true });
        } else { next(); }
      });

      server.middlewares.use('/api/waiting', async (req, res, next) => {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = body.sessionId as string;
          const session = sessions.get(sessionId);
          if (session) {
            session.status = 'waiting';
            session.currentTool = null;
            session.lastActivity = Date.now();
            broadcast({ type: 'waiting', sessionId });
          }
          jsonResponse(res, { ok: true });
        } else { next(); }
      });

      server.middlewares.use('/api/sessions', (req, res, next) => {
        if (req.method === 'GET') {
          jsonResponse(res, getSessionsSnapshot());
        } else { next(); }
      });

      server.middlewares.use('/api/teams', (req, res, next) => {
        if (req.method === 'GET') {
          scanTeams();
          jsonResponse(res, getTeamsSnapshot());
        } else { next(); }
      });

      server.middlewares.use('/api/tasks', (req, res, next) => {
        if (req.method === 'GET') {
          scanTasks();
          jsonResponse(res, getTasksSnapshot());
        } else { next(); }
      });

      server.middlewares.use('/api/health', (req, res, next) => {
        if (req.method === 'GET') {
          jsonResponse(res, { status: 'ok', sessions: sessions.size, teams: teams.size });
        } else { next(); }
      });

      console.log('\x1b[36m[Agent Monitor]\x1b[0m Hook API ready on /api/*');
      console.log('\x1b[36m[Agent Monitor]\x1b[0m WebSocket ready on /ws');
    },
  };
}

export default defineConfig({
  plugins: [react(), browserMockAssetsPlugin(), agentMonitorPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  base: './',
  server: {
    port: 4200,
    open: true,
  },
});
