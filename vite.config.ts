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
}

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
        ws.send(JSON.stringify({ type: 'init', sessions: getSessionsSnapshot() }));
      });

      // Hook API endpoints
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
            });
          }
          broadcast({ type: 'session_start', session: sessions.get(sessionId) });
          jsonResponse(res, { ok: true, id: sessionId });
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
            session.tools.push({
              name: tool,
              category: toolCategory,
              startedAt: Date.now(),
              input: '',
            });
            if (session.tools.length > 50) session.tools.shift();
            broadcast({ type: 'tool_start', sessionId, tool, category: toolCategory });
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
            broadcast({ type: 'tool_end', sessionId, tool });
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

      server.middlewares.use('/api/health', (req, res, next) => {
        if (req.method === 'GET') {
          jsonResponse(res, { status: 'ok', sessions: sessions.size });
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
