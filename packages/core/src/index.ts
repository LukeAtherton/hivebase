export type {
  AgentType,
  Capability,
  SessionState,
  SpawnSpec,
  AgentSession,
  AgentMessage,
  NormalisedEvent,
  NormalisedEventType,
  PlanItem,
  TriggerType,
  Severity,
  DecisionStatus,
  DecisionSummary,
  AgentAdapter,
  AgentStage,
  AutonomyCapability,
  AutonomyLevel,
  ScopeArtifact,
  ScopeArtifactStatus,
} from './types.js';

export {
  stageFromSessionState,
  AUTONOMY_CAPABILITIES,
  AGENT_STAGES,
  scopeArtifactReadyToAgree,
  renderScopeArtifactForAgent,
} from './types.js';

export { classify } from './triggers.js';
export type { ClassifiedTrigger } from './triggers.js';

export { mapTriggerToCapability, triggerIsAlwaysHuman } from './autonomy.js';
