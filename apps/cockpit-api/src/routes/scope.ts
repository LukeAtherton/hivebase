import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  cockpitScopeArtifacts,
  cockpitSessions,
  getCockpitDb,
} from '@kybernos/platform';
import { generateCockpitScopeArtifactId } from '@kybernos/ids';
import {
  renderScopeArtifactForAgent,
  scopeArtifactReadyToAgree,
  type ScopeArtifact,
} from '@kybernos/core';
import { ClaudeCodeLocalAdapter } from '../adapters/claude-code/adapter.js';
import { spawnAgentWithPolicy, SpawnError } from '../lib/spawn-helpers.js';
import { getController } from '../runtime/SessionController.js';
import type { Config } from '../config.js';

const ScopeStartBody = z.object({
  cockpitProjectId: z.string(),
  // The seed instruction the operator types into the scoping surface to
  // start the conversation. This is NOT the final task — it's a seed for
  // the agent's investigation. The agreed scope artifact is what the
  // implementation agent will see post-handoff.
  seedPrompt: z.string().min(1),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  label: z.string().optional(),
});

export async function registerScopeRoutes(app: FastifyInstance, config: Config) {
  const adapter = new ClaudeCodeLocalAdapter(config.hookEndpointUrl);

  // /scope/start — spawn a scoping agent + create a draft scope artifact.
  //
  // The agent is launched in stage='scoping'; per the trusted-default
  // preset the gate logic in persistence.ts treats edit-files /
  // destructive / install-package / etc. as 'never' during scoping, so
  // the agent is effectively read-only without any extra plumbing.
  app.post('/scope/start', async (req, reply) => {
    const body = ScopeStartBody.parse(req.body);
    try {
      const spawnResult = await spawnAgentWithPolicy({
        cockpitProjectId: body.cockpitProjectId,
        task: body.seedPrompt,
        stage: 'scoping',
        branch: body.branch,
        baseBranch: body.baseBranch,
        label: body.label ?? 'scoping',
        adapter,
      });

      const db = getCockpitDb();
      const cockpitScopeArtifactId = generateCockpitScopeArtifactId();
      const now = new Date().toISOString();

      await db.insert(cockpitScopeArtifacts).values({
        cockpitScopeArtifactId,
        cockpitSessionId: spawnResult.cockpitSessionId,
        cockpitProjectId: body.cockpitProjectId,
        status: 'draft',
        task: '',
        acceptanceCriteria: [],
        nonGoals: [],
        touchSurface: [],
        autonomyPreset: 'trusted-default',
        supersededBy: null,
        createdAt: now,
        updatedAt: now,
        agreedAt: null,
      });

      return {
        ...spawnResult,
        cockpitScopeArtifactId,
      };
    } catch (err) {
      if (err instanceof SpawnError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
  });

  // GET the artifact for a given session — the scoping surface polls
  // / subscribes to this. (Live updates via WS event-bus to follow.)
  app.get('/scope/by-session/:sessionId', async (req, reply) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const [row] = await getCockpitDb()
      .select()
      .from(cockpitScopeArtifacts)
      .where(eq(cockpitScopeArtifacts.cockpitSessionId, sessionId))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'no scope artifact for session' });
    return row;
  });

  // GET the artifact directly by id.
  app.get('/scope/:artifactId', async (req, reply) => {
    const artifactId = (req.params as { artifactId: string }).artifactId;
    const [row] = await getCockpitDb()
      .select()
      .from(cockpitScopeArtifacts)
      .where(eq(cockpitScopeArtifacts.cockpitScopeArtifactId, artifactId))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'unknown artifactId' });
    return row;
  });

  // Quick way to confirm scoping sessions in tests + UIs without
  // loading the full session+stage join.
  app.get('/scope/sessions/:sessionId/stage', async (req) => {
    const sessionId = (req.params as { sessionId: string }).sessionId;
    const [row] = await getCockpitDb()
      .select({
        stage: cockpitSessions.stage,
        state: cockpitSessions.state,
      })
      .from(cockpitSessions)
      .where(eq(cockpitSessions.cockpitSessionId, sessionId))
      .limit(1);
    return row ?? null;
  });

  // PATCH the artifact while it's still in 'draft'. Operator edits +
  // agent suggestions both flow through here. Once status='agreed' the
  // artifact is frozen; further edits 409.
  const PatchBody = z
    .object({
      task: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      nonGoals: z.array(z.string()).optional(),
      touchSurface: z.array(z.string()).optional(),
      autonomyPreset: z.string().optional(),
    })
    .strict();

  app.patch('/scope/:artifactId', async (req, reply) => {
    const artifactId = (req.params as { artifactId: string }).artifactId;
    const body = PatchBody.parse(req.body);
    const db = getCockpitDb();
    const [existing] = await db
      .select()
      .from(cockpitScopeArtifacts)
      .where(eq(cockpitScopeArtifacts.cockpitScopeArtifactId, artifactId))
      .limit(1);
    if (!existing) return reply.status(404).send({ error: 'unknown artifactId' });
    if (existing.status !== 'draft') {
      return reply
        .status(409)
        .send({ error: `artifact is ${existing.status}; only draft artifacts are editable` });
    }

    const now = new Date().toISOString();
    const next = {
      task: body.task ?? existing.task,
      acceptanceCriteria: body.acceptanceCriteria ?? existing.acceptanceCriteria,
      nonGoals: body.nonGoals ?? existing.nonGoals,
      touchSurface: body.touchSurface ?? existing.touchSurface,
      autonomyPreset: body.autonomyPreset ?? existing.autonomyPreset,
      updatedAt: now,
    };
    await db
      .update(cockpitScopeArtifacts)
      .set(next)
      .where(eq(cockpitScopeArtifacts.cockpitScopeArtifactId, artifactId));
    const [refreshed] = await db
      .select()
      .from(cockpitScopeArtifacts)
      .where(eq(cockpitScopeArtifacts.cockpitScopeArtifactId, artifactId))
      .limit(1);
    return refreshed;
  });

  // POST /scope/:artifactId/agree — the scoping → implementation
  // transition. Lock the artifact, stop the scoping agent, spawn a
  // fresh implementation agent in a clean context with the artifact
  // rendered as initial user message (per agent-handoff-decision.md).
  app.post('/scope/:artifactId/agree', async (req, reply) => {
    const artifactId = (req.params as { artifactId: string }).artifactId;
    const db = getCockpitDb();
    const [existing] = await db
      .select()
      .from(cockpitScopeArtifacts)
      .where(eq(cockpitScopeArtifacts.cockpitScopeArtifactId, artifactId))
      .limit(1);
    if (!existing) return reply.status(404).send({ error: 'unknown artifactId' });
    if (existing.status !== 'draft') {
      return reply.status(409).send({ error: `artifact is already ${existing.status}` });
    }

    // Cast to the canonical type for the renderer. Drizzle returns a
    // close-but-not-identical shape (jsonb columns are typed as the array
    // here, just narrower null tracking).
    const artifact = existing as unknown as ScopeArtifact;
    if (!scopeArtifactReadyToAgree(artifact)) {
      return reply.status(400).send({
        error: 'artifact missing required content (task + ≥1 acceptance criterion)',
      });
    }

    const now = new Date().toISOString();

    // Lock the artifact first. Failures after this leave a clean state:
    // the scoping session continues running but the artifact is agreed,
    // which the operator can spot.
    await db
      .update(cockpitScopeArtifacts)
      .set({ status: 'agreed', agreedAt: now, updatedAt: now })
      .where(eq(cockpitScopeArtifacts.cockpitScopeArtifactId, artifactId));

    // Stop the scoping agent. The session row gets state='stopped'
    // immediately so the UI updates; the controller's stop() (if live)
    // SIGTERMs the child process.
    const scopingController = getController(existing.cockpitSessionId);
    if (scopingController) scopingController.stop('handed-off-to-implementation');
    await db
      .update(cockpitSessions)
      .set({ state: 'stopped', endedAt: now })
      .where(eq(cockpitSessions.cockpitSessionId, existing.cockpitSessionId));

    // Spawn fresh implementation agent. The artifact is the entire
    // context — no scoping transcript carries over.
    try {
      const initialMessage = renderScopeArtifactForAgent(artifact);
      const spawnResult = await spawnAgentWithPolicy({
        cockpitProjectId: existing.cockpitProjectId,
        task: initialMessage,
        stage: 'implementation',
        presetName: existing.autonomyPreset,
        label: artifact.task.slice(0, 40),
        adapter,
      });
      return {
        cockpitScopeArtifactId: artifactId,
        scopingSessionId: existing.cockpitSessionId,
        implementationSessionId: spawnResult.cockpitSessionId,
        implementationAgentId: spawnResult.cockpitAgentId,
      };
    } catch (err) {
      if (err instanceof SpawnError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
  });
}
