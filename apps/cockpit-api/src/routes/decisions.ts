import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, asc, inArray } from 'drizzle-orm';
import {
  getCockpitDb,
  cockpitDecisions,
  cockpitDecisionLedger,
  cockpitSessions,
} from '@swarm/platform';
import { generateCockpitLedgerId } from '@swarm/ids';
import { eventBus } from '../lib/event-bus.js';
import { getController, type ResolverChoice } from '../runtime/SessionController.js';

const ResolveBody = z.object({
  reply: z.string().optional(),
  reason: z.string().optional(),
  decidedBy: z.string(),
});

export async function registerDecisionRoutes(app: FastifyInstance) {
  // Aged oldest-first — matches the queue UX in the plan.
  app.get('/decisions', async (req) => {
    const status = (req.query as { status?: string }).status ?? 'open';
    const rows = await getCockpitDb()
      .select()
      .from(cockpitDecisions)
      .where(eq(cockpitDecisions.status, status))
      .orderBy(asc(cockpitDecisions.createdAt))
      .limit(500);
    return { decisions: rows };
  });

  app.post('/decisions/:id/approve', async (req, reply) => {
    return resolveDecision(req, reply, 'approved');
  });
  app.post('/decisions/:id/block', async (req, reply) => {
    return resolveDecision(req, reply, 'blocked');
  });
  app.post('/decisions/:id/reply', async (req, reply) => {
    return resolveDecision(req, reply, 'replied');
  });
}

async function resolveDecision(
  req: FastifyRequest,
  reply: FastifyReply,
  choice: 'approved' | 'blocked' | 'replied',
) {
  const id = (req.params as { id: string }).id;
  const body = ResolveBody.parse(req.body);
  const db = getCockpitDb();
  const [decision] = await db
    .select()
    .from(cockpitDecisions)
    .where(eq(cockpitDecisions.cockpitDecisionId, id))
    .limit(1);
  if (!decision) return reply.status(404).send({ error: 'not found' });
  if (decision.status !== 'open') {
    return reply.status(409).send({ error: 'already resolved' });
  }
  const now = new Date().toISOString();

  await db
    .update(cockpitDecisions)
    .set({
      status: choice,
      resolvedAt: now,
      resolvedBy: body.decidedBy,
    })
    .where(eq(cockpitDecisions.cockpitDecisionId, id));

  await db.insert(cockpitDecisionLedger).values({
    cockpitLedgerId: generateCockpitLedgerId(),
    cockpitDecisionId: decision.cockpitDecisionId,
    cockpitSessionId: decision.cockpitSessionId,
    cockpitAgentId: decision.cockpitAgentId,
    triggerType: decision.triggerType,
    question: decision.question,
    choice,
    reply: body.reply,
    reason: body.reason,
    decidedAt: now,
    decidedBy: body.decidedBy,
  });

  // Resolve the held canUseTool / Notification promise on the SessionController,
  // if the session is still live in this process. Map our DB `choice` back to
  // the controller's ResolverChoice shape.
  const controller = getController(decision.cockpitSessionId);
  if (controller) {
    const resolverChoice: ResolverChoice =
      choice === 'approved'
        ? { kind: 'approved' }
        : choice === 'replied'
          ? { kind: 'replied', reply: body.reply ?? '' }
          : { kind: 'blocked', message: body.reason ?? 'denied by cockpit', interrupt: true };
    controller.resolve(id, resolverChoice);
  }

  // Restore session state if no other open decisions remain.
  const remaining = await db
    .select({ id: cockpitDecisions.cockpitDecisionId })
    .from(cockpitDecisions)
    .where(
      and(
        eq(cockpitDecisions.cockpitSessionId, decision.cockpitSessionId),
        inArray(cockpitDecisions.status, ['open']),
      ),
    )
    .limit(1);
  if (remaining.length === 0) {
    await db
      .update(cockpitSessions)
      .set({ state: 'implementing' })
      .where(eq(cockpitSessions.cockpitSessionId, decision.cockpitSessionId));
  }

  eventBus.emit('decision-resolved', {
    decisionId: id,
    choice,
    reply: body.reply,
  });

  return { ok: true, choice };
}
