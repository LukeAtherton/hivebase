import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  getCockpitDb,
  cockpitEvents,
  cockpitDecisions,
  cockpitSessions,
} from '@swarm/platform';
import { generateCockpitDecisionId } from '@swarm/ids';
import { classify, type NormalisedEvent } from '@swarm/core';
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
    await db.insert(cockpitEvents).values({
      cockpitEventId: event.cockpitEventId,
      cockpitSessionId: event.cockpitSessionId,
      cockpitAgentId: event.cockpitAgentId,
      type: event.type,
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
      const decisionId = generateCockpitDecisionId();
      const cooldownMs = cooldownMsFor(trigger.severity);
      const expiresAt = cooldownMs ? new Date(Date.now() + cooldownMs) : null;
      await db.insert(cockpitDecisions).values({
        cockpitDecisionId: decisionId,
        cockpitSessionId: event.cockpitSessionId,
        cockpitAgentId: event.cockpitAgentId,
        cockpitEventId: event.cockpitEventId,
        triggerType: trigger.triggerType,
        severity: trigger.severity,
        status: 'open',
        question: trigger.question,
        toolName: trigger.toolName,
        command: trigger.command,
        filePath: trigger.filePath,
        payload: event.payload,
        defaultChoice: defaultChoiceFor(trigger.severity),
        expiresAt: expiresAt?.toISOString() ?? null,
        mode: 'pause-on-decision',
        createdAt: event.timestamp,
      });

      if (trigger.severity === 'required') {
        await db
          .update(cockpitSessions)
          .set({ state: 'needs-decision' })
          .where(eq(cockpitSessions.cockpitSessionId, event.cockpitSessionId));
      }

      if (expiresAt) {
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

function numField(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
