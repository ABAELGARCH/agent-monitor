/**
 * TeamOverlay — Renders team hierarchy, boss badge, department labels,
 * and a task board on top of the pixel art office.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

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

interface AgentMeta {
  agentId: number;
  sessionId: string;
  isLead: boolean;
  teamRole: string;
  teamName: string;
  memberName: string;
}

const ROLE_COLORS: Record<string, string> = {
  'team-lead': '#f59e0b',
  'backend-engineer': '#6366f1',
  'frontend-engineer': '#22c55e',
  'quality-assurance': '#ec4899',
  'devops-engineer': '#f97316',
  'research-analyst': '#a855f7',
  default: '#6a6a8a',
};

const ROLE_ICONS: Record<string, string> = {
  'team-lead': '\u2654',       // crown
  'backend-engineer': '\u2699', // gear
  'frontend-engineer': '\u{1F3A8}', // palette
  'quality-assurance': '\u{1F50D}', // magnifier
  'devops-engineer': '\u{1F680}',   // rocket
  'research-analyst': '\u{1F4DA}',  // books
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#6a6a8a',
  in_progress: '#6366f1',
  completed: '#22c55e',
};

export function TeamOverlay(): JSX.Element | null {
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [tasks, setTasks] = useState<Record<string, TaskInfo[]>>({});
  const [agentMetas, setAgentMetas] = useState<AgentMeta[]>([]);
  const [showTaskBoard, setShowTaskBoard] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const metaMapRef = useRef(new Map<number, AgentMeta>());

  useEffect(() => {
    const handleTeams = ((e: CustomEvent) => {
      setTeams(e.detail.teams || []);
      setTasks(e.detail.tasks || {});
    }) as EventListener;

    const handleMeta = ((e: CustomEvent) => {
      const m = e.detail as AgentMeta;
      metaMapRef.current.set(m.agentId, m);
      setAgentMetas(Array.from(metaMapRef.current.values()));
    }) as EventListener;

    window.addEventListener('agent-monitor:teams', handleTeams);
    window.addEventListener('agent-monitor:session-meta', handleMeta);
    return () => {
      window.removeEventListener('agent-monitor:teams', handleTeams);
      window.removeEventListener('agent-monitor:session-meta', handleMeta);
    };
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const toggleTaskBoard = useCallback(() => setShowTaskBoard((t) => !t), []);

  if (teams.length === 0) return null;

  const team = teams[0]; // Primary team
  const allTasks = Object.values(tasks).flat();
  const activeMetas = agentMetas.filter((m) => m.teamName);

  return (
    <>
      {/* Team header bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 70%, transparent 100%)',
          padding: '8px 16px 20px',
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'auto' }}>
          <span style={{ fontSize: 18 }}>{'\u2654'}</span>
          <span
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 11,
              color: '#f59e0b',
              textShadow: '0 0 10px rgba(245, 158, 11, 0.5)',
            }}
          >
            {team.teamName}
          </span>
          <span style={{ fontSize: 10, color: '#6a6a8a', marginLeft: 4 }}>
            {team.members.length} agents
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={toggleTaskBoard}
            style={{
              ...btnStyle,
              background: showTaskBoard ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
            }}
          >
            Tasks
          </button>
          <button onClick={toggleCollapsed} style={btnStyle}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>

      {/* Department roster — left side */}
      {!collapsed && (
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 8,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
            pointerEvents: 'auto',
          }}
        >
          {team.members.map((member) => {
            const color = ROLE_COLORS[member.role] || ROLE_COLORS.default;
            const icon = ROLE_ICONS[member.role] || '\u{1F916}';
            const isOnline = activeMetas.some((m) => m.memberName === member.name);
            const meta = activeMetas.find((m) => m.memberName === member.name);

            return (
              <div
                key={member.name}
                style={{
                  background: 'rgba(0,0,0,0.85)',
                  border: `1px solid ${isOnline ? color : 'rgba(42,42,58,0.5)'}`,
                  borderRadius: 4,
                  padding: '6px 10px',
                  minWidth: 160,
                  opacity: isOnline ? 1 : 0.4,
                  transition: 'all 0.3s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <span
                    style={{
                      fontFamily: '"Press Start 2P", monospace',
                      fontSize: 8,
                      color: isOnline ? color : '#444',
                    }}
                  >
                    {member.name}
                  </span>
                  {member.role === 'team-lead' && (
                    <span
                      style={{
                        fontSize: 7,
                        fontFamily: '"Press Start 2P", monospace',
                        background: '#f59e0b',
                        color: '#000',
                        padding: '1px 4px',
                        borderRadius: 2,
                        fontWeight: 'bold',
                        marginLeft: 'auto',
                      }}
                    >
                      BOSS
                    </span>
                  )}
                  {isOnline && member.role !== 'team-lead' && (
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: '#22c55e',
                        marginLeft: 'auto',
                        boxShadow: '0 0 4px #22c55e',
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#6a6a8a',
                    marginTop: 2,
                  }}
                >
                  {member.role.replace(/-/g, ' ')}
                  {member.model && (
                    <span style={{ marginLeft: 6, color: '#444' }}>
                      ({member.model})
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task board — right side */}
      {!collapsed && showTaskBoard && allTasks.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 48,
            right: 8,
            zIndex: 55,
            background: 'rgba(0,0,0,0.9)',
            border: '1px solid #2a2a3a',
            borderRadius: 4,
            padding: 10,
            maxWidth: 280,
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 8,
              color: '#6366f1',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{'\u{1F4CB}'}</span> Task Board
          </div>
          {allTasks.map((task) => (
            <div
              key={task.id}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${STATUS_COLORS[task.status] || '#2a2a3a'}33`,
                borderLeft: `3px solid ${STATUS_COLORS[task.status] || '#2a2a3a'}`,
                borderRadius: 3,
                padding: '5px 8px',
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: STATUS_COLORS[task.status] || '#6a6a8a',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: '#e4e4ef',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {task.subject}
                </span>
              </div>
              {task.activeForm && task.status === 'in_progress' && (
                <div
                  style={{
                    fontSize: 9,
                    color: '#6366f1',
                    marginTop: 2,
                    marginLeft: 12,
                    fontStyle: 'italic',
                  }}
                >
                  {task.activeForm}
                </div>
              )}
              {task.owner && (
                <div
                  style={{
                    fontSize: 8,
                    color: '#6a6a8a',
                    marginTop: 2,
                    marginLeft: 12,
                  }}
                >
                  {'\u2192'} {task.owner}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const btnStyle: React.CSSProperties = {
  fontFamily: '"Press Start 2P", monospace',
  fontSize: 8,
  color: '#e4e4ef',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid #2a2a3a',
  borderRadius: 3,
  padding: '4px 10px',
  cursor: 'pointer',
  pointerEvents: 'auto',
};
