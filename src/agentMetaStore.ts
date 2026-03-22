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
