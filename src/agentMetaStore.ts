/**
 * Shared store for agent team metadata.
 * Populated by agentBridge, consumed by renderer and overlay components.
 */

export interface AgentMetaEntry {
  sessionId: string;
  isLead: boolean;
  teamRole: string;
  teamName: string;
  memberName: string;
  progress: number; // 0.0 to 1.0 — real progress based on tool completions
  isFinished: boolean; // true when agent has completed their work
}

const metaMap = new Map<number, AgentMetaEntry>();

export function setAgentMeta(agentId: number, meta: AgentMetaEntry): void {
  metaMap.set(agentId, meta);
}

export function getAgentMetaMap(): Map<number, AgentMetaEntry> {
  return metaMap;
}

export function getAgentMeta(agentId: number): AgentMetaEntry | undefined {
  return metaMap.get(agentId);
}

export function removeAgentMeta(agentId: number): void {
  metaMap.delete(agentId);
}

export function updateAgentProgress(agentId: number, progress: number): void {
  const entry = metaMap.get(agentId);
  if (entry) {
    entry.progress = progress;
  }
}

export function markAgentFinished(agentId: number): void {
  const entry = metaMap.get(agentId);
  if (entry) {
    entry.progress = 1.0;
    entry.isFinished = true;
  }
}
