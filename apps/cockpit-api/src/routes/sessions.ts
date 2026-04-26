import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import {
  getCockpitDb,
  cockpitSessions,
  cockpitEvents,
  cockpitAgents,
  cockpitProjects,
  cockpitAutonomyPolicies,
} from '@kybernos/platform';
import { getController } from '../runtime/SessionController.js';

const SendMessageBody = z.object({
  text: z.string().min(1),
});

export async function registerSessionRoutes(app: FastifyInstance) {
  // Fleet view: every active session, joined with its agent for type/label
  // and its project for the territorial portfolio map.
  app.get('/sessions', async () => {
    const rows = await getCockpitDb()
      .select({
        cockpitSessionId: cockpitSessions.cockpitSessionId,
        cockpitAgentId: cockpitSessions.cockpitAgentId,
        cockpitProjectId: cockpitSessions.cockpitProjectId,
        state: cockpitSessions.state,
        task: cockpitSessions.task,
        startedAt: cockpitSessions.startedAt,
        endedAt: cockpitSessions.endedAt,
        lastEventAt: cockpitSessions.lastEventAt,
        currentTodos: cockpitSessions.currentTodos,
        cumulativeInputTokens: cockpitSessions.cumulativeInputTokens,
        cumulativeCostUsd: cockpitSessions.cumulativeCostUsd,
        contextWindow: cockpitSessions.contextWindow,
        agentType: cockpitAgents.agentType,
        agentLabel: cockpitAgents.label,
        projectName: cockpitProjects.name,
      })
      .from(cockpitSessions)
      .leftJoin(cockpitAgents, eq(cockpitAgents.cockpitAgentId, cockpitSessions.cockpitAgentId))
      .leftJoin(
        cockpitProjects,
        eq(cockpitProjects.cockpitProjectId, cockpitSessions.cockpitProjectId),
      )
      .orderBy(desc(cockpitSessions.createdAt))
      .limit(200);
    return { sessions: rows };
  });

  // Read-only autonomy policy view per agent. Returns the full
  // capability × stage matrix the gate logic in persistence.ts consults.
  // Used by the SessionDetail policy panel.
  app.get('/agents/:id/policies', async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await getCockpitDb()
      .select({
        capability: cockpitAutonomyPolicies.capability,
        stage: cockpitAutonomyPolicies.stage,
        level: cockpitAutonomyPolicies.level,
      })
      .from(cockpitAutonomyPolicies)
      .where(eq(cockpitAutonomyPolicies.cockpitAgentId, id));
    return { policies: rows };
  });

  app.get('/sessions/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const [session] = await getCockpitDb()
      .select()
      .from(cockpitSessions)
      .where(eq(cockpitSessions.cockpitSessionId, id))
      .limit(1);
    if (!session) return reply.status(404).send({ error: 'not found' });
    return session;
  });

  app.get('/sessions/:id/events', async (req) => {
    const id = (req.params as { id: string }).id;
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 200), 1000);
    const rows = await getCockpitDb()
      .select()
      .from(cockpitEvents)
      .where(eq(cockpitEvents.cockpitSessionId, id))
      .orderBy(desc(cockpitEvents.timestamp))
      .limit(limit);
    return { events: rows };
  });

  // Push a follow-up user message into a live session. Used by the queue
  // when the human wants to steer without a destructive-decision context.
  app.post('/sessions/:id/message', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = SendMessageBody.parse(req.body);
    const controller = getController(id);
    if (!controller) return reply.status(404).send({ error: 'session not live in this process' });
    if (controller.ended()) return reply.status(409).send({ error: 'session ended' });
    await controller.sendUserMessage({ text: body.text });
    return { ok: true };
  });

  // Stop a session. Aborts the controller (which kills the claude child via
  // SIGTERM/SIGKILL) and marks the row stopped. Idempotent: ok-stops a row
  // that's already DB-stopped or whose controller is no longer in-process.
  app.post('/sessions/:id/stop', async (req) => {
    const id = (req.params as { id: string }).id;
    const controller = getController(id);
    if (controller) controller.stop('user-stop');
    const now = new Date().toISOString();
    await getCockpitDb()
      .update(cockpitSessions)
      .set({ state: 'stopped', endedAt: now })
      .where(eq(cockpitSessions.cockpitSessionId, id));
    return { ok: true };
  });
}
