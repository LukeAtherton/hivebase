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
