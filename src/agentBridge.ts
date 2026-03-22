/**
 * Agent Bridge — WebSocket client that receives hook events from the
 * agent-monitor server and translates them into the same window.postMessage
 * events that the VS Code extension would send.
 *
 * Now also handles Agent Teams: boss/lead, departments, task board.
 */

let ws: WebSocket | null = null;
let nextAgentId = 1;
const sessionToAgent = new Map<string, number>();
const agentToSession = new Map<number, string>();

// Team state
interface TeamMember {
  name: string;
  role: string;
  model?: string;
  responsibilities?: string[];
}

interface TeamData {
  teamName: string;
  description: string;
  members: TeamMember[];
}

interface TaskInfo {
  id: string;
  subject: string;
  status: string;
  owner?: string;
  activeForm?: string;
}

interface SessionData {
  id: string;
  name: string;
  character: string;
  status: string;
  currentTool: string | null;
  teamName?: string;
  teamRole?: string;
  teamMemberName?: string;
  isLead?: boolean;
}

let currentTeams: TeamData[] = [];
let currentTasks: Record<string, TaskInfo[]> = {};

// Custom event for team/task updates (consumed by TeamOverlay component)
function dispatchTeamEvent(teams: TeamData[], tasks: Record<string, TaskInfo[]>): void {
  currentTeams = teams;
  currentTasks = tasks;
  window.dispatchEvent(
    new CustomEvent('agent-monitor:teams', { detail: { teams, tasks } }),
  );
}

function dispatchSessionMeta(
  agentId: number,
  session: SessionData,
): void {
  window.dispatchEvent(
    new CustomEvent('agent-monitor:session-meta', {
      detail: {
        agentId,
        sessionId: session.id,
        name: session.name,
        teamName: session.teamName,
        teamRole: session.teamRole,
        teamMemberName: session.teamMemberName,
        isLead: session.isLead,
      },
    }),
  );
}

function dispatch(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

function handleMessage(data: Record<string, unknown>): void {
  switch (data.type) {
    case 'init': {
      const sessionsArr = (data.sessions || []) as SessionData[];
      const teams = (data.teams || []) as TeamData[];
      const tasks = (data.tasks || {}) as Record<string, TaskInfo[]>;

      dispatchTeamEvent(teams, tasks);

      for (const session of sessionsArr) {
        if (!sessionToAgent.has(session.id)) {
          const agentId = nextAgentId++;
          sessionToAgent.set(session.id, agentId);
          agentToSession.set(agentId, session.id);

          // Use team member name as folderName for the label
          const label = session.teamMemberName || session.name;
          dispatch({
            type: 'agentCreated',
            id: agentId,
            folderName: label,
          });

          dispatchSessionMeta(agentId, session);

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
      break;
    }

    case 'session_start': {
      const session = data.session as SessionData | undefined;
      if (!session) break;
      const sid = session.id;
      if (!sessionToAgent.has(sid)) {
        const agentId = nextAgentId++;
        sessionToAgent.set(sid, agentId);
        agentToSession.set(agentId, sid);

        const label = session.teamMemberName || session.name;
        dispatch({
          type: 'agentCreated',
          id: agentId,
          folderName: label,
        });

        dispatchSessionMeta(agentId, session);
      }
      break;
    }

    case 'tool_start': {
      const agentId = sessionToAgent.get(data.sessionId as string || '');
      if (agentId != null && data.tool) {
        dispatch({
          type: 'agentToolStart',
          id: agentId,
          toolId: `tool-${Date.now()}-${agentId}`,
          status: data.tool as string,
        });
      }
      break;
    }

    case 'tool_end': {
      const agentId = sessionToAgent.get(data.sessionId as string || '');
      if (agentId != null) {
        dispatch({ type: 'agentToolsClear', id: agentId });
        dispatch({ type: 'agentStatus', id: agentId, status: 'active' });
      }
      break;
    }

    case 'waiting': {
      const agentId = sessionToAgent.get(data.sessionId as string || '');
      if (agentId != null) {
        dispatch({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
      break;
    }

    case 'session_end': {
      const agentId = sessionToAgent.get(data.sessionId as string || '');
      if (agentId != null) {
        dispatch({ type: 'agentClosed', id: agentId });
        sessionToAgent.delete(data.sessionId as string || '');
        agentToSession.delete(agentId);
      }
      break;
    }

    case 'session_removed': {
      const agentId = sessionToAgent.get(data.sessionId as string || '');
      if (agentId != null) {
        dispatch({ type: 'agentClosed', id: agentId });
        sessionToAgent.delete(data.sessionId as string || '');
        agentToSession.delete(agentId);
      }
      break;
    }

    case 'teams_update': {
      const teams = (data.teams || []) as TeamData[];
      const tasks = (data.tasks || currentTasks) as Record<string, TaskInfo[]>;
      dispatchTeamEvent(teams, tasks);
      break;
    }

    case 'tasks_update': {
      const tasks = (data.tasks || {}) as Record<string, TaskInfo[]>;
      dispatchTeamEvent(currentTeams, tasks);
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

// Expose getters for React components
export function getTeams(): TeamData[] {
  return currentTeams;
}

export function getTasks(): Record<string, TaskInfo[]> {
  return currentTasks;
}

export function getAgentMeta(): Map<number, { sessionId: string; isLead: boolean; teamRole: string; teamName: string; memberName: string }> {
  // This will be populated by session-meta events
  return agentMetaMap;
}

// Agent metadata populated via custom events
const agentMetaMap = new Map<number, { sessionId: string; isLead: boolean; teamRole: string; teamName: string; memberName: string }>();

// Listen for our own meta events to populate the map
if (typeof window !== 'undefined') {
  window.addEventListener('agent-monitor:session-meta', ((e: CustomEvent) => {
    const d = e.detail;
    agentMetaMap.set(d.agentId, {
      sessionId: d.sessionId,
      isLead: d.isLead || false,
      teamRole: d.teamRole || '',
      teamName: d.teamName || '',
      memberName: d.teamMemberName || d.name || '',
    });
  }) as EventListener);
}
