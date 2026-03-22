/**
 * Agent Bridge — WebSocket client that receives hook events from the
 * agent-monitor server and translates them into the same window.postMessage
 * events that the VS Code extension would send.
 *
 * This replaces the VS Code extension's agent lifecycle management
 * for standalone browser usage.
 */

let ws: WebSocket | null = null;
let nextAgentId = 1;
const sessionToAgent = new Map<string, number>();
const agentToSession = new Map<number, string>();

function dispatch(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

/** Map tool name to a status string matching what the extension sends */
function toolToStatus(tool: string): string {
  if (!tool) return 'Working...';
  // Strip mcp__ prefix for readability
  const clean = tool.replace(/^mcp__\w+__/, '');
  return clean;
}

function handleMessage(data: {
  type: string;
  sessionId?: string;
  session?: {
    id: string;
    name: string;
    character: string;
    status: string;
    currentTool: string | null;
  };
  tool?: string;
  category?: string;
  sessions?: Array<{
    id: string;
    name: string;
    character: string;
    status: string;
    currentTool: string | null;
  }>;
}): void {
  switch (data.type) {
    case 'init': {
      // Server sends all existing sessions on connect
      if (data.sessions) {
        for (const session of data.sessions) {
          if (!sessionToAgent.has(session.id)) {
            const agentId = nextAgentId++;
            sessionToAgent.set(session.id, agentId);
            agentToSession.set(agentId, session.id);
            dispatch({
              type: 'agentCreated',
              id: agentId,
              folderName: session.name,
            });
            // If agent is currently doing something, set it active
            if (session.status !== 'idle' && session.status !== 'done') {
              dispatch({
                type: 'agentToolStart',
                id: agentId,
                toolId: `tool-${Date.now()}-${agentId}`,
                status: session.currentTool || session.status,
              });
            }
          }
        }
      }
      break;
    }

    case 'session_start': {
      if (!data.session) break;
      const sid = data.session.id;
      if (!sessionToAgent.has(sid)) {
        const agentId = nextAgentId++;
        sessionToAgent.set(sid, agentId);
        agentToSession.set(agentId, sid);
        dispatch({
          type: 'agentCreated',
          id: agentId,
          folderName: data.session.name,
        });
      }
      break;
    }

    case 'tool_start': {
      const agentId = sessionToAgent.get(data.sessionId || '');
      if (agentId != null && data.tool) {
        dispatch({
          type: 'agentToolStart',
          id: agentId,
          toolId: `tool-${Date.now()}-${agentId}`,
          status: toolToStatus(data.tool),
        });
      }
      break;
    }

    case 'tool_end': {
      const agentId = sessionToAgent.get(data.sessionId || '');
      if (agentId != null) {
        // Clear tools and set idle
        dispatch({ type: 'agentToolsClear', id: agentId });
        dispatch({ type: 'agentStatus', id: agentId, status: 'active' });
      }
      break;
    }

    case 'waiting': {
      const agentId = sessionToAgent.get(data.sessionId || '');
      if (agentId != null) {
        dispatch({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
      break;
    }

    case 'session_end': {
      const agentId = sessionToAgent.get(data.sessionId || '');
      if (agentId != null) {
        dispatch({ type: 'agentClosed', id: agentId });
        sessionToAgent.delete(data.sessionId || '');
        agentToSession.delete(agentId);
      }
      break;
    }

    case 'session_removed': {
      const agentId = sessionToAgent.get(data.sessionId || '');
      if (agentId != null) {
        dispatch({ type: 'agentClosed', id: agentId });
        sessionToAgent.delete(data.sessionId || '');
        agentToSession.delete(agentId);
      }
      break;
    }
  }
}

export function connectAgentBridge(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws`;

  function connect(): void {
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[AgentBridge] Connected to agent-monitor server');
    };

    ws.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string);
        handleMessage(data);
      } catch (err) {
        console.error('[AgentBridge] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[AgentBridge] Disconnected, reconnecting in 2s...');
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();
}
