import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  getCockpitDb,
  cockpitEvents,
  cockpitDecisions,
  cockpitDecisionLedger,
  cockpitSessions,
  cockpitAutonomyPolicies,
} from '@kybernos/platform';
import { generateCockpitDecisionId, generateCockpitLedgerId } from '@kybernos/ids';
import {
  classify,
  mapTriggerToCapability,
  triggerIsAlwaysHuman,
  stageFromSessionState,
  type AgentStage,
  type AutonomyLevel,
  type ClassifiedTrigger,
  type NormalisedEvent,
  type SessionState,
} from '@kybernos/core';
import { eventBus } from './event-bus.js';
import { scheduleCooldown } from './cooldown-scheduler.js';
import { cooldownMsFor, defaultChoiceFor } from './decision-defaults.js';

// States we'll move forward from on tool activity. We never clobber
// 'needs-decision', 'blocked', 'ready-for-review', 'merged', or 'stopped'.
const TRANSITION_FROM_PRE = ['queued', 'orienting', 'implementing', 'validating'];

const VALIDATION_TOOL_PATTERN = /test|typecheck|build|lint/i;

// Persists every NormalisedEvent + applies session lifecycle state transitions
// + classifies events into decisions for adapters that can't gate inline.
//
// Adapters that own the gating decision themselves (e.g. the SDK adapter,
// which holds a canUseTool Promise) set `payload.__skipClassification = true`
// on the event so this layer doesn't double-write the same decision row.
export function startPersistence() {
  eventBus.on('event', (event: NormalisedEvent) => {
    void persist(event);
  });
}

async function persist(event: NormalisedEvent) {
  const db = getCockpitDb();
  try {
    // Promote frequently-queried payload fields into typed columns. Keeps
    // the JSON blob honest as a generic envelope while making classifier
    // and analytics queries cheap. See docs/future-work-research.md §5.
    const toolNameTyped =
      typeof event.payload['toolName'] === 'string' ? (event.payload['toolName'] as string) : null;
    const exitCodeRaw = event.payload['exitCode'];
    const exitCodeTyped = typeof exitCodeRaw === 'number' ? exitCodeRaw : null;

    await db.insert(cockpitEvents).values({
      cockpitEventId: event.cockpitEventId,
      cockpitSessionId: event.cockpitSessionId,
      cockpitAgentId: event.cockpitAgentId,
      type: event.type,
      toolName: toolNameTyped,
      exitCode: exitCodeTyped,
      payload: event.payload,
      timestamp: event.timestamp,
    });

    await db
      .update(cockpitSessions)
      .set({ lastEventAt: event.timestamp })
      .where(eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId));

    if (event.type === 'session.started') {
      await db
        .update(cockpitSessions)
        .set({ state: 'orienting', startedAt: event.timestamp })
        .where(eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId));
    }
    if (event.type === 'session.ended') {
      await db
        .update(cockpitSessions)
        .set({ state: 'stopped', endedAt: event.timestamp })
        .where(eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId));
    }
    // First tool call → 'implementing'. We use a guarded UPDATE WHERE state IN
    // (...) so a session sitting in 'needs-decision' or further-progressed
    // states isn't dragged backwards by a stray tool.pre.
    if (event.type === 'tool.pre') {
      await db
        .update(cockpitSessions)
        .set({ state: 'implementing' })
        .where(
          and(
            eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId),
            inArray(cockpitSessions.state, TRANSITION_FROM_PRE),
          ),
        );
    }
    // PostToolUse on a test/typecheck/build/lint tool → 'validating'.
    if (event.type === 'tool.post') {
      const toolName = event.payload['toolName'];
      if (typeof toolName === 'string' && VALIDATION_TOOL_PATTERN.test(toolName)) {
        await db
          .update(cockpitSessions)
          .set({ state: 'validating' })
          .where(
            and(
              eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId),
              inArray(cockpitSessions.state, TRANSITION_FROM_PRE),
            ),
          );
      }
    }
    // cost.updated rolls up cumulative tokens + cost on the session row so
    // the map can show context-pressure as tile height.
    if (event.type === 'cost.updated') {
      const turnTokens = numField(event.payload['turnTokens']);
      const totalCostUsd = numField(event.payload['totalCostUsd']);
      if (turnTokens > 0 || totalCostUsd > 0) {
        await db
          .update(cockpitSessions)
          .set({
            cumulativeInputTokens: sql`${cockpitSessions.cumulativeInputTokens} + ${turnTokens}`,
            // total_cost_usd from the SDK/CLI is per-turn, accumulate it.
            cumulativeCostUsd: sql`${cockpitSessions.cumulativeCostUsd} + ${totalCostUsd}`,
          })
          .where(eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId));
      }
    }

    if (event.payload['__skipClassification'] === true) return;

    const trigger = classify(event);
    if (trigger) {
      // --- Sheridan autonomy gate ---
      // Some triggers always require a human (scope-ambiguity,
      // architectural-tradeoff). Everything else is subject to per-agent
      // policy lookup: allow → suppress + audit-log the auto-allow;
      // never → write a pre-resolved blocked decision; ask → current
      // behaviour.
      let policyLevel: AutonomyLevel = 'ask';
      if (!triggerIsAlwaysHuman(trigger)) {
        policyLevel = await lookupPolicy(event.cockpitAgentId, event.cockpitSessionId, trigger);
      }

      if (policyLevel === 'allow') {
        // Suppressed by policy. Record a ledger entry for traceability,
        // then return — no decision row, no operator interruption.
        await writeAutoLedger(event, trigger, 'approved');
        return;
      }

      const decisionId = generateCockpitDecisionId();
      const cooldownMs = cooldownMsFor(trigger.severity);
      const expiresAt = cooldownMs ? new Date(Date.now() + cooldownMs) : null;

      // For policy=never, write the decision pre-resolved. The hook
      // path will see status=blocked when it polls for verdict.
      const status = policyLevel === 'never' ? 'blocked' : 'open';
      const resolvedAt = policyLevel === 'never' ? event.timestamp : null;
      const resolvedBy = policyLevel === 'never' ? 'autonomy-policy' : null;

      await db.insert(cockpitDecisions).values({
        cockpitDecisionId: decisionId,
        cockpitSessionId: event.cockpitSessionId,
        cockpitAgentId: event.cockpitAgentId,
        cockpitEventId: event.cockpitEventId,
        triggerType: trigger.triggerType,
        severity: trigger.severity,
        status,
        question: trigger.question,
        // Card v2: classifier-enriched fields.
        detail: trigger.detail ?? null,
        evidenceLines: trigger.evidenceLines ?? null,
        rejectOptions: trigger.rejectOptions ?? null,
        toolName: trigger.toolName,
        command: trigger.command,
        filePath: trigger.filePath,
        payload: event.payload,
        defaultChoice: defaultChoiceFor(trigger.severity),
        expiresAt: expiresAt?.toISOString() ?? null,
        mode: 'pause-on-decision',
        createdAt: event.timestamp,
        resolvedAt,
        resolvedBy,
      });

      if (policyLevel === 'never') {
        await writeAutoLedger(event, trigger, 'blocked', decisionId);
      }

      if (trigger.severity === 'required' && policyLevel === 'ask') {
        await db
          .update(cockpitSessions)
          .set({ state: 'needs-decision' })
          .where(eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId));
      }

      if (expiresAt && policyLevel === 'ask') {
        void scheduleCooldown(decisionId, expiresAt).catch((err) =>
          console.error('[persistence] scheduleCooldown failed', err),
        );
      }

      eventBus.emit('decision-created', { decisionId, event, trigger });
    }
  } catch (err) {
    console.error('[persistence] failed to persist event', event.cockpitEventId, err);
  }
}

// Look up the most-specific policy applying to (agent, capability, stage).
// Per-agent rows always win over preset rows. Falls back to 'ask' if no
// row matches (defensive default — never auto-suppress without a policy).
async function lookupPolicy(
  agentId: string,
  sessionId: string,
  trigger: ClassifiedTrigger,
): Promise<AutonomyLevel> {
  const db = getCockpitDb();
  const capability = mapTriggerToCapability(trigger);

  // Read session.stage; if it's set explicitly use it; otherwise derive
  // from session.state (older agents pre-stage-column).
  const sessionRow = await db
    .select({ stage: cockpitSessions.stage, state: cockpitSessions.state })
    .from(cockpitSessions)
    .where(eq(cockpitSessions.cockpitSessionId, sessionId))
    .limit(1);
  let stage: AgentStage = 'implementation';
  if (sessionRow[0]) {
    stage = (sessionRow[0].stage as AgentStage | null)
      ?? stageFromSessionState(sessionRow[0].state as SessionState);
  }

  const rows = await db
    .select({ level: cockpitAutonomyPolicies.level })
    .from(cockpitAutonomyPolicies)
    .where(
      and(
        eq(cockpitAutonomyPolicies.cockpitAgentId, agentId),
        eq(cockpitAutonomyPolicies.capability, capability),
        eq(cockpitAutonomyPolicies.stage, stage),
      ),
    )
    .limit(1);

  return (rows[0]?.level as AutonomyLevel | undefined) ?? 'ask';
}

// Append a ledger row for a policy-suppressed decision so the audit trail
// reflects what would otherwise have been a queue card.
async function writeAutoLedger(
  event: NormalisedEvent,
  trigger: ClassifiedTrigger,
  choice: 'approved' | 'blocked',
  decisionId?: string,
): Promise<void> {
  const db = getCockpitDb();
  await db.insert(cockpitDecisionLedger).values({
    cockpitLedgerId: generateCockpitLedgerId(),
    // Synthetic id when no decision row was written (the allow case).
    cockpitDecisionId: decisionId ?? `auto-${event.cockpitEventId}`,
    cockpitSessionId: event.cockpitSessionId,
    cockpitAgentId: event.cockpitAgentId,
    triggerType: trigger.triggerType,
    question: trigger.question,
    agentAssumption: null,
    choice,
    reply: null,
    reason: 'autonomy-policy',
    refs: { command: trigger.command, filePath: trigger.filePath },
    decidedAt: event.timestamp,
    decidedBy: 'autonomy-policy',
  });
}

function numField(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
