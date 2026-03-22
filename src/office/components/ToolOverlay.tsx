import { useEffect, useState } from 'react';

import { getAgentMeta } from '../../agentMetaStore.js';
import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

const ROLE_COLORS: Record<string, string> = {
  'team-lead': '#f59e0b',
  'backend-engineer': '#6366f1',
  'frontend-engineer': '#22c55e',
  'quality-assurance': '#ec4899',
  'devops-engineer': '#f97316',
  'research-analyst': '#a855f7',
};

const ROLE_ICONS: Record<string, string> = {
  'team-lead': '\u2654',
  'backend-engineer': '\u2699',
  'frontend-engineer': '\u{1F3A8}',
  'quality-assurance': '\u{1F50D}',
  'devops-engineer': '\u{1F680}',
  'research-analyst': '\u{1F4DA}',
};

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;

        // Only show for hovered or selected agents (unless always-show is on)
        if (!alwaysShowOverlay && !isSelected && !isHovered) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        let activityText: string;
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            const sub = subagentCharacters.find((s) => s.id === id);
            activityText = sub ? sub.label : 'Subtask';
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive);
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (hasPermission) {
          dotColor = 'var(--pixel-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--pixel-status-active)';
        }

        // Get team metadata for this agent
        const meta = getAgentMeta(id);
        const roleColor = meta ? (ROLE_COLORS[meta.teamRole] || '#6a6a8a') : undefined;
        const roleIcon = meta ? (ROLE_ICONS[meta.teamRole] || '') : '';
        const borderColor = isSelected
          ? (roleColor || 'var(--pixel-border-light)')
          : (isHovered && roleColor ? roleColor + '88' : 'var(--pixel-border)');

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: isSelected || isHovered ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !isSelected && !isHovered ? (isSub ? 0.5 : 0.75) : 1,
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(0,0,0,0.92)',
                border: `2px solid ${borderColor}`,
                borderRadius: 0,
                padding: '4px 8px',
                boxShadow: roleColor ? `0 0 8px ${roleColor}33` : 'var(--pixel-shadow)',
                whiteSpace: 'nowrap',
                maxWidth: 280,
                minWidth: isHovered ? 140 : undefined,
              }}
            >
              {/* Header row: role icon + name + status dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {roleIcon && <span style={{ fontSize: 12 }}>{roleIcon}</span>}
                {dotColor && (
                  <span
                    className={isActive && !hasPermission ? 'pixel-agents-pulse' : undefined}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: isSub ? '20px' : '22px',
                    fontStyle: isSub ? 'italic' : undefined,
                    color: roleColor || 'var(--vscode-foreground)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flex: 1,
                  }}
                >
                  {activityText}
                </span>
                {meta?.isLead && (
                  <span style={{
                    fontSize: '14px',
                    background: '#f59e0b',
                    color: '#000',
                    padding: '0 3px',
                    fontWeight: 'bold',
                    fontFamily: '"Press Start 2P", monospace',
                    lineHeight: 1.4,
                  }}>BOSS</span>
                )}
                {isSelected && !isSub && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseAgent(id);
                    }}
                    title="Close agent"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--pixel-close-text)',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '26px',
                      lineHeight: 1,
                      marginLeft: 2,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)';
                    }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Extended info on hover */}
              {isHovered && meta && (
                <div style={{ marginTop: 3, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 3 }}>
                  <div style={{ fontSize: '16px', color: roleColor || '#aaa' }}>
                    {meta.memberName}
                    <span style={{ color: '#666', marginLeft: 4 }}>
                      {meta.teamRole.replace(/-/g, ' ')}
                    </span>
                  </div>
                  {meta.teamName && (
                    <div style={{ fontSize: '14px', color: '#555', marginTop: 1 }}>
                      {'\u2654'} {meta.teamName}
                    </div>
                  )}
                </div>
              )}

              {/* Folder name */}
              {!meta && ch.folderName && (
                <span
                  style={{
                    fontSize: '16px',
                    color: 'var(--pixel-text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                >
                  {ch.folderName}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
