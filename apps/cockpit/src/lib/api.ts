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

export interface RejectOption {
  id: string;
  label: string;
  reply: string;
}

export interface DecisionRow {
  cockpitDecisionId: string;
  cockpitSessionId: string;
  cockpitAgentId: string;
  triggerType: string;
  severity: 'info' | 'advisory' | 'required';
  status: string;
  question: string;
  // Card v2 enrichment.
  detail: string | null;
  evidenceLines: string[] | null;
  rejectOptions: RejectOption[] | null;
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
  listAgentPolicies: (agentId: string) =>
    jget<{ policies: PolicyRow[] }>(`/agents/${agentId}/policies`),
  scopeStart: (body: {
    cockpitProjectId: string;
    seedPrompt: string;
    branch?: string;
    label?: string;
  }) =>
    jpost<{
      cockpitAgentId: string;
      cockpitSessionId: string;
      cockpitWorkspaceId: string;
      cockpitScopeArtifactId: string;
      worktreePath: string;
      branch: string;
    }>('/scope/start', body),
  getScopeArtifact: (artifactId: string) =>
    jget<ScopeArtifactRow>(`/scope/${artifactId}`),
  patchScopeArtifact: (
    artifactId: string,
    body: Partial<{
      task: string;
      acceptanceCriteria: string[];
      nonGoals: string[];
      touchSurface: string[];
      autonomyPreset: string;
    }>,
  ) => jpatch<ScopeArtifactRow>(`/scope/${artifactId}`, body),
  agreeScopeArtifact: (artifactId: string) =>
    jpost<{
      cockpitScopeArtifactId: string;
      scopingSessionId: string;
      implementationSessionId: string;
      implementationAgentId: string;
    }>(`/scope/${artifactId}/agree`, {}),
  // Upload an image attached to a seed prompt. Returns the absolute
  // path on the host so the eventual implementation agent (running
  // locally) can read it via the same path.
  listTicker: (limit = 60) =>
    jget<{ items: TickerItem[] }>(`/ticker?limit=${limit}`),
  // Territory intel — git state for the hex-tile map. The full list is
  // what the canvas consumes; the per-session call is for tile-detail.
  listTerritory: () => jget<{ territories: SessionIntel[] }>('/territory'),
  getSessionTerritory: (sessionId: string) =>
    jget<SessionIntel>(`/sessions/${sessionId}/territory`),
  getSessionFileDiff: (sessionId: string, path: string) =>
    jget<{ path: string; diff: string }>(
      `/sessions/${sessionId}/diff?path=${encodeURIComponent(path)}`,
    ),
  uploadScopeImage: async (file: File, artifactId?: string): Promise<UploadResult> => {
    const fd = new FormData();
    fd.append('file', file);
    const qs = artifactId ? `?artifactId=${encodeURIComponent(artifactId)}` : '';
    const res = await fetch(`/api/scope/uploads${qs}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`/scope/uploads: ${res.status} ${text}`);
    }
    return (await res.json()) as UploadResult;
  },
};

export interface UploadResult {
  path: string;
  filename: string;
  mimetype: string;
  bytes: number;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  authoredAt: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'other';
  insertions: number;
  deletions: number;
}

export interface PrStatus {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  isDraft: boolean;
  reviewDecision?:
    | 'APPROVED'
    | 'CHANGES_REQUESTED'
    | 'REVIEW_REQUIRED'
    | 'COMMENTED'
    | null;
}

export interface SessionIntel {
  cockpitSessionId: string;
  branch: string;
  worktreePath: string;
  mainBranch: string;
  branchHead: string | null;
  mergeBase: string | null;
  merged: boolean;
  commits: GitCommit[];
  changedFiles: ChangedFile[];
  pr: PrStatus | null;
  worktreeModifiedAt: string | null;
}

export interface TickerItem {
  ts: string;
  kind: 'error' | 'notification' | 'session' | 'decision' | 'plan';
  severity?: 'required' | 'advisory' | 'info';
  message: string;
  cockpitSessionId?: string;
  cockpitAgentId?: string;
}

export interface ScopeArtifactRow {
  cockpitScopeArtifactId: string;
  cockpitSessionId: string;
  cockpitProjectId: string;
  status: 'draft' | 'agreed' | 'superseded';
  task: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  touchSurface: string[];
  autonomyPreset: string;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
  agreedAt: string | null;
}

async function jpatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export interface PolicyRow {
  capability: string;
  stage: string;
  level: 'allow' | 'ask' | 'never';
}
