import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateCockpitDecisionId, generateCockpitEventId } from '@kybernos/ids';
import { classify, type NormalisedEvent, type NormalisedEventType } from '@kybernos/core';
import { getCockpitDb, cockpitDecisions, cockpitSessions } from '@kybernos/platform';
import { eventBus } from '../lib/event-bus.js';
import { scheduleCooldown } from '../lib/cooldown-scheduler.js';
import { cooldownMsFor, defaultChoiceFor } from '../lib/decision-defaults.js';
import {
  type ClaudeCodeHookEnvelope,
  extractCommand,
  extractFilePath,
} from '../adapters/claude-code/hook-payload.js';

// How long the verdict long-poll holds before giving up. Long enough that the
// human has time to act, short enough that an orphaned hook script doesn't
// pin a connection forever.
const VERDICT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function registerHookRoutes(app: FastifyInstance) {
  // Phase 1 of the hook bridge.
  //
  // Returns one of:
  //   { verdict: 'allow' }     - no decision needed, claude proceeds
  //   { decisionId: 'ckde_…' } - cockpit gating; script must long-poll /verdict
  //   { ok: true }             - non-PreToolUse event accepted, no action needed
  app.post('/hooks/claude-code', async (req, reply) => {
    const sessionId = req.headers['x-cockpit-session-id'];
    if (typeof sessionId !== 'string' || !sessionId) {
      return reply.status(400).send({ error: 'missing X-Cockpit-Session-Id' });
    }

    const body = (req.body ?? {}) as ClaudeCodeHookEnvelope;
    const session = await loadSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'unknown session' });

    const event = mapToNormalised(sessionId, session.cockpitAgentId, body);
    if (!event) return { ok: true };

    // We only own gating-decision creation for PreToolUse / Notification events
    // — those are the ones we classify inline below to gate the running tool.
    // tool.post (PostToolUseFailure → failed-validation) is left UNFLAGGED so
    // persistence.ts classifies it normally. Otherwise no failed-validation
    // decisions ever get written.
    if (body.hook_event_name === 'PreToolUse' || body.hook_event_name === 'Notification') {
      event.payload.__skipClassification = true;
    }
    eventBus.publish(event);

    if (body.hook_event_name !== 'PreToolUse') {
      return { ok: true };
    }

    // Gating path. Classify the event; if no trigger matches, allow immediately.
    const trigger = classify(event);
    if (!trigger) return { verdict: 'allow' };

    const decisionId = generateCockpitDecisionId();
    const now = new Date();
    const cooldownMs = cooldownMsFor(trigger.severity);
    const expiresAt = cooldownMs ? new Date(now.getTime() + cooldownMs) : null;
    await getCockpitDb()
      .insert(cockpitDecisions)
      .values({
        cockpitDecisionId: decisionId,
        cockpitSessionId: sessionId,
        cockpitAgentId: session.cockpitAgentId,
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
        createdAt: now.toISOString(),
      });
    if (trigger.severity === 'required') {
      await getCockpitDb()
        .update(cockpitSessions)
        .set({ state: 'needs-decision' })
        .where(eq(cockpitSessions.cockpitSessionId, sessionId));
    }
    if (expiresAt) {
      void scheduleCooldown(decisionId, expiresAt).catch((err) =>
        console.error('[hooks] scheduleCooldown failed', err),
      );
    }
    eventBus.emit('decision-created', { decisionId, event, trigger });
    return { decisionId };
  });

  // Phase 2 of the hook bridge. Long-poll until the decision is resolved.
  // Returns: { verdict: 'allow' | 'deny', reason?: string }
  app.get('/hooks/verdict/:decisionId', async (req, reply) => {
    const decisionId = (req.params as { decisionId: string }).decisionId;

    // Fast path: maybe it's already resolved (race / restart).
    const fast = await loadDecision(decisionId);
    if (!fast) return reply.status(404).send({ error: 'unknown decision' });
    if (fast.status !== 'open') {
      return { verdict: verdictFor(fast.status), reason: fast.question };
    }

    // Slow path: subscribe to the bus, await resolution.
    return await new Promise<{ verdict: 'allow' | 'deny'; reason?: string }>((resolve) => {
      const onResolved = (msg: { decisionId: string; choice: string; reply?: string }) => {
        if (msg.decisionId !== decisionId) return;
        cleanup();
        resolve({
          verdict: verdictFor(msg.choice),
          reason: msg.reply ?? undefined,
        });
      };
      const timer = setTimeout(() => {
        cleanup();
        // Surface as deny so the agent doesn't run an unreviewed tool — the
        // hook script will print {permissionDecision:'deny'} and claude moves on.
        resolve({ verdict: 'deny', reason: 'cockpit verdict timeout' });
      }, VERDICT_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        eventBus.off('decision-resolved', onResolved);
      };
      // Disable Fastify's connection idle timeout for this request.
      reply.raw.setTimeout(VERDICT_TIMEOUT_MS + 5000);
      eventBus.on('decision-resolved', onResolved);
    });
  });
}

async function loadSession(cockpitSessionId: string) {
  const [row] = await getCockpitDb()
    .select({ cockpitAgentId: cockpitSessions.cockpitAgentId })
    .from(cockpitSessions)
    .where(eq(cockpitSessions.cockpitSessionId, cockpitSessionId))
    .limit(1);
  return row ?? null;
}

async function loadDecision(decisionId: string) {
  const [row] = await getCockpitDb()
    .select()
    .from(cockpitDecisions)
    .where(eq(cockpitDecisions.cockpitDecisionId, decisionId))
    .limit(1);
  return row ?? null;
}

function mapToNormalised(
  sessionId: string,
  agentId: string,
  body: ClaudeCodeHookEnvelope,
): NormalisedEvent | null {
  const baseType: NormalisedEventType | null = (() => {
    switch (body.hook_event_name) {
      case 'PreToolUse':
        return 'tool.pre';
      case 'PostToolUse':
        return 'tool.post';
      case 'PostToolUseFailure':
        // Same NormalisedEvent type — distinguished by exitCode/error in payload.
        return 'tool.post';
      case 'Notification':
        return 'notification';
      default:
        return null;
    }
  })();
  if (!baseType) return null;

  const command = extractCommand(body.tool_input);
  const filePath = extractFilePath(body.tool_input);

  const payload: Record<string, unknown> = {
    raw: body,
    toolName: body.tool_name,
    command,
    filePath,
  };
  if (body.message) payload.message = body.message;
  if (body.tool_response?.exit_code !== undefined) {
    payload.exitCode = body.tool_response.exit_code;
  }
  // PostToolUseFailure carries `error` string + the kind in hook_event_name.
  // Synthesise an exitCode so the failed-validation classifier matches.
  if (body.hook_event_name === 'PostToolUseFailure') {
    payload.isError = true;
    payload.error = body.error ?? 'tool failed';
    if (payload.exitCode === undefined) payload.exitCode = 1;
  }

  return {
    cockpitEventId: generateCockpitEventId(),
    cockpitSessionId: sessionId,
    cockpitAgentId: agentId,
    type: baseType,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function verdictFor(status: string): 'allow' | 'deny' {
  return status === 'approved' ? 'allow' : 'deny';
}
