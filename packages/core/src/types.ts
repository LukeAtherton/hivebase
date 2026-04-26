// Cockpit core types — adapter contract + normalised events + decision shape.
// Deliberately small. Pure types, no runtime deps beyond shared IDs.

export type AgentType =
  | 'claude-code-local'
  | 'codex-cli-local'
  | 'hivescaler-builder'
  | 'hivescaler-extractor';

// Verbs an adapter supports. The cockpit UI hides actions an adapter can't honour.
export type Capability = 'spawn' | 'attach' | 'send-message' | 'stop' | 'pause' | 'resume';

export type SessionState =
  | 'queued'
  | 'orienting'
  | 'implementing'
  | 'validating'
  | 'blocked'
  | 'needs-decision'
  | 'ready-for-review'
  | 'merged'
  | 'stale-zombie'
  | 'stopped';

// What an adapter receives when the cockpit asks it to spawn an agent.
export interface SpawnSpec {
  cockpitProjectId: string;
  cockpitAgentId: string;
  cockpitSessionId: string;
  task: string;
  // Local adapters: the worktree path. Cloud adapters: ignored.
  workingDirectory?: string;
  // Local adapters: the branch name created by the worktree service.
  branch?: string;
  // Free-form metadata an adapter may consume (model, autonomy preset, etc.).
  metadata?: Record<string, unknown>;
}

// Returned by spawn(). The adapter's handle on the running session.
export interface AgentSession {
  cockpitSessionId: string;
  // Adapter-native ID (PID for local, jobId for hivescaler).
  externalId: string;
  startedAt: string; // ISO
}

export interface AgentMessage {
  // For local Claude Code: text typed back into the running session.
  // For hivescaler: forwarded via client.sendMessage().
  text: string;
  // Optional: caller-chosen kind so adapters that distinguish (e.g. "approval"
  // vs "freeform reply") can route correctly.
  kind?: 'approval' | 'denial' | 'reply' | 'cancel';
  // If this message resolves a specific decision, link it for the ledger.
  decisionId?: string;
}

// --- Normalised events -----------------------------------------------------
// Every adapter emits this shape. The cockpit UI never branches on AgentType
// for rendering — only for which actions to show.

export type NormalisedEventType =
  | 'session.started'
  | 'session.state-changed'
  | 'session.ended'
  | 'tool.pre' // about to call a tool — gating point for destructive checks
  | 'tool.post' // tool finished — exit code matters
  | 'text.delta' // streamed model text
  | 'notification' // agent explicitly asks for human input
  | 'plan.updated' // agent's todo/plan list changed (e.g. Claude Code TodoWrite)
  | 'cost.updated'
  | 'error';

// A single item in an agent's plan. Adapter-agnostic.
export interface PlanItem {
  content: string; // imperative ("Fix login bug")
  activeForm?: string; // present-continuous ("Fixing login bug") — optional
  status: 'pending' | 'in_progress' | 'completed';
}

export interface NormalisedEvent {
  cockpitEventId: string;
  cockpitSessionId: string;
  cockpitAgentId: string;
  type: NormalisedEventType;
  timestamp: string; // ISO
  // Type-specific payload. Kept loose on purpose — narrow at consumers.
  payload: Record<string, unknown>;
  // Filled in by the trigger classifier when the event becomes a decision.
  triggerType?: TriggerType;
  severity?: Severity;
}

// --- Decisions -------------------------------------------------------------
// Triggers from the plan's Trigger Classification table.

export type TriggerType =
  | 'scope-ambiguity'
  | 'destructive-action'
  | 'architectural-tradeoff'
  | 'failed-validation'
  | 'merge-conflict'
  | 'security-concern'
  | 'spend-threshold'
  | 'time-threshold';

export type Severity = 'info' | 'advisory' | 'required';

export type DecisionStatus = 'open' | 'approved' | 'blocked' | 'replied' | 'expired';

// --- Autonomy (Sheridan) ---------------------------------------------------
// Per-agent (or per-preset) capability × stage policy. Gate logic consults
// before classifier fires. See docs/stage-bottleneck-matrix.md and
// docs/group-a-plan.md.

export type AgentStage = 'scoping' | 'implementation' | 'verification';

export type Capability_ =
  | 'read-files'
  | 'edit-files'
  | 'run-tests'
  | 'run-build'
  | 'run-migrations'
  | 'push-branch'
  | 'open-pr'
  | 'merge-pr'
  | 'network-fetch'
  | 'install-package'
  | 'destructive'
  | 'delete-files'
  | 'spend-over-threshold';

// Aliased to avoid colliding with the existing adapter Capability type
// (which describes adapter verbs like 'spawn'/'attach'). Different concept,
// different concern. Renaming is heavy; the underscore export is exposed
// under a clearer name from this module.
export type AutonomyCapability = Capability_;

export type AutonomyLevel = 'allow' | 'ask' | 'never';

// All capabilities, in the order we render them in the policy matrix.
export const AUTONOMY_CAPABILITIES: readonly AutonomyCapability[] = [
  'read-files',
  'edit-files',
  'run-tests',
  'run-build',
  'run-migrations',
  'push-branch',
  'open-pr',
  'merge-pr',
  'network-fetch',
  'install-package',
  'destructive',
  'delete-files',
  'spend-over-threshold',
] as const;

export const AGENT_STAGES: readonly AgentStage[] = [
  'scoping',
  'implementation',
  'verification',
] as const;

// --- Scope artifacts -------------------------------------------------------
// Per agent-handoff-decision.md: the artifact IS the entire context the
// implementation agent sees on handoff. Lifecycle: draft → agreed →
// (optionally) superseded.

export type ScopeArtifactStatus = 'draft' | 'agreed' | 'superseded';

export interface ScopeArtifact {
  cockpitScopeArtifactId: string;
  cockpitSessionId: string;
  cockpitProjectId: string;
  status: ScopeArtifactStatus;
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

// Whether an artifact has the minimum content required to agree on it.
// At least a task statement + one acceptance criterion. Implementation
// agents need both to pick up the work without re-asking.
export function scopeArtifactReadyToAgree(a: Pick<ScopeArtifact, 'task' | 'acceptanceCriteria'>): boolean {
  return a.task.trim().length > 0 && a.acceptanceCriteria.length > 0;
}

// Render a scope artifact as the implementation agent's initial user
// message. This is the entire context the impl agent will see — its
// purpose, its acceptance criteria, what is explicitly NOT in scope, and
// which files are in the touch surface. Per agent-handoff-decision.md.
export function renderScopeArtifactForAgent(a: ScopeArtifact): string {
  const lines: string[] = [];
  lines.push('# Agreed scope');
  lines.push('');
  lines.push('## Task');
  lines.push(a.task);

  if (a.acceptanceCriteria.length > 0) {
    lines.push('');
    lines.push('## Acceptance criteria');
    for (const c of a.acceptanceCriteria) lines.push(`- ${c}`);
  }

  if (a.nonGoals.length > 0) {
    lines.push('');
    lines.push('## Non-goals (do NOT do these)');
    for (const n of a.nonGoals) lines.push(`- ${n}`);
  }

  if (a.touchSurface.length > 0) {
    lines.push('');
    lines.push('## Touch surface');
    lines.push('Files expected to be edited:');
    for (const f of a.touchSurface) lines.push(`- ${f}`);
  }

  lines.push('');
  lines.push(`Autonomy preset: ${a.autonomyPreset}.`);
  lines.push('Implement strictly per the criteria above. If you discover the scope is wrong, surface a scope-question rather than expanding scope unilaterally.');
  return lines.join('\n');
}

// Map a SessionState to the conceptual AgentStage. Used by the gate logic
// to look up the right policy at decision time. Pre-merge states map to
// implementation by default; orienting maps to scoping; ready-for-review
// maps to verification.
export function stageFromSessionState(state: SessionState): AgentStage {
  switch (state) {
    case 'queued':
    case 'orienting':
      return 'scoping';
    case 'ready-for-review':
      return 'verification';
    default:
      return 'implementation';
  }
}

// What the queue UI renders. Kept narrow — the full event/payload lives on
// cockpit_events for drill-down.
export interface DecisionSummary {
  decisionId: string;
  cockpitSessionId: string;
  cockpitAgentId: string;
  triggerType: TriggerType;
  severity: Severity;
  question: string; // human-readable; adapter-supplied or classifier-generated
  // Optional context the queue card surfaces without a click.
  toolName?: string;
  command?: string;
  filePath?: string;
  createdAt: string; // ISO
  status: DecisionStatus;
}

// --- Adapter contract ------------------------------------------------------

export interface AgentAdapter {
  readonly type: AgentType;
  readonly capabilities: readonly Capability[];

  spawn(spec: SpawnSpec): Promise<AgentSession>;
  // Live event stream. Cockpit-api consumes and persists + fans out via WS.
  attach(cockpitSessionId: string): AsyncIterable<NormalisedEvent>;
  send(cockpitSessionId: string, message: AgentMessage): Promise<void>;
  stop(cockpitSessionId: string): Promise<void>;
}
