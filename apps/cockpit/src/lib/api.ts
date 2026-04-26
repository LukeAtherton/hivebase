// Thin client for cockpit-api. Vite proxies /api → cockpit-api.

export interface PlanItem {
  content: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface SessionRow {
  cockpitSessionId: string;
  cockpitAgentId: string;
  cockpitProjectId: string;
  state: string;
  task: string;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  agentType: string | null;
  agentLabel: string | null;
  currentTodos?: PlanItem[] | null;
  projectName?: string | null;
  cumulativeInputTokens?: number;
  cumulativeCostUsd?: number;
  contextWindow?: number;
}

export interface DecisionRow {
  cockpitDecisionId: string;
  cockpitSessionId: string;
  cockpitAgentId: string;
  triggerType: string;
  severity: 'info' | 'advisory' | 'required';
  status: string;
  question: string;
  toolName: string | null;
  command: string | null;
  filePath: string | null;
  defaultChoice: string | null;
  defaultReply: string | null;
  expiresAt: string | null;
  mode: string;
  createdAt: string;
}

export interface ProjectRow {
  cockpitProjectId: string;
  name: string;
  kind: string;
  repoPath: string | null;
}

export interface EventRow {
  cockpitEventId: string;
  cockpitSessionId: string;
  cockpitAgentId: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listSessions: () => jget<{ sessions: SessionRow[] }>('/sessions'),
  listDecisions: (status: string = 'open') =>
    jget<{ decisions: DecisionRow[] }>(`/decisions?status=${encodeURIComponent(status)}`),
  listProjects: () => jget<{ projects: ProjectRow[] }>('/projects'),
  createProject: (body: {
    name: string;
    kind: 'local-repo' | 'hivescaler';
    repoPath?: string;
    workspaceId: string;
    createdBy: string;
  }) => jpost<{ cockpitProjectId: string }>('/projects', body),
  spawn: (body: {
    cockpitProjectId: string;
    agentType: 'claude-code-local';
    task: string;
    branch?: string;
    label?: string;
  }) =>
    jpost<{
      cockpitAgentId: string;
      cockpitSessionId: string;
      worktreePath: string;
      branch: string;
    }>('/spawn', body),
  approve: (id: string, decidedBy: string, reason?: string) =>
    jpost(`/decisions/${id}/approve`, { decidedBy, reason }),
  block: (id: string, decidedBy: string, reason?: string) =>
    jpost(`/decisions/${id}/block`, { decidedBy, reason }),
  reply: (id: string, decidedBy: string, reply: string, reason?: string) =>
    jpost(`/decisions/${id}/reply`, { decidedBy, reply, reason }),
  sendSessionMessage: (sessionId: string, text: string) =>
    jpost<{ ok: true }>(`/sessions/${sessionId}/message`, { text }),
  stopSession: (sessionId: string) => jpost<{ ok: true }>(`/sessions/${sessionId}/stop`, {}),
  listSessionEvents: (sessionId: string, limit = 200) =>
    jget<{ events: EventRow[] }>(`/sessions/${sessionId}/events?limit=${limit}`),
};
