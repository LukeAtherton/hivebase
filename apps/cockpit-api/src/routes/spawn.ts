import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  getCockpitDb,
  cockpitProjects,
  cockpitAgents,
  cockpitSessions,
} from '@swarm/platform';
import { generateCockpitAgentId, generateCockpitSessionId } from '@swarm/ids';
import { ClaudeCodeLocalAdapter } from '../adapters/claude-code/adapter.js';
import { createWorktree } from '../lib/worktrees.js';
import type { Config } from '../config.js';

const SpawnBody = z.object({
  cockpitProjectId: z.string(),
  agentType: z.literal('claude-code-local'),
  task: z.string().min(1),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  label: z.string().optional(),
});

export async function registerSpawnRoutes(app: FastifyInstance, config: Config) {
  // Local agents use the `claude` CLI binary so they consume the user's
  // subscription tokens, not API tokens. The SDK-based adapter
  // (apps/cockpit-api/src/adapters/sdk/adapter.ts) is kept in the codebase
  // for future cloud-billed agent types (hivescaler-builder, etc.) — see
  // COCKPIT_PLAN.md "Local adapter mechanism" for the rationale.
  const adapter = new ClaudeCodeLocalAdapter(config.hookEndpointUrl);

  app.post('/spawn', async (req, reply) => {
    const body = SpawnBody.parse(req.body);
    const db = getCockpitDb();

    const [project] = await db
      .select()
      .from(cockpitProjects)
      .where(eq(cockpitProjects.cockpitProjectId, body.cockpitProjectId))
      .limit(1);
    if (!project) return reply.status(404).send({ error: 'unknown cockpitProjectId' });
    if (project.kind !== 'local-repo' || !project.repoPath) {
      return reply.status(400).send({ error: 'claude-code-local requires a local-repo project' });
    }

    const worktree = await createWorktree({
      cockpitProjectId: body.cockpitProjectId,
      repoPath: project.repoPath,
      branch: body.branch,
      baseBranch: body.baseBranch,
    });

    const cockpitAgentId = generateCockpitAgentId();
    const cockpitSessionId = generateCockpitSessionId();
    const now = new Date().toISOString();

    await db.insert(cockpitAgents).values({
      cockpitAgentId,
      cockpitProjectId: body.cockpitProjectId,
      cockpitWorkspaceId: worktree.cockpitWorkspaceId,
      agentType: body.agentType,
      label: body.label,
      capabilities: Array.from(adapter.capabilities),
      createdAt: now,
    });

    await db.insert(cockpitSessions).values({
      cockpitSessionId,
      cockpitAgentId,
      cockpitProjectId: body.cockpitProjectId,
      state: 'queued',
      task: body.task,
      createdAt: now,
    });

    const session = await adapter.spawn({
      cockpitProjectId: body.cockpitProjectId,
      cockpitAgentId,
      cockpitSessionId,
      task: body.task,
      workingDirectory: worktree.worktreePath,
      branch: worktree.branch,
    });

    await db
      .update(cockpitSessions)
      .set({ externalId: session.externalId })
      .where(eq(cockpitSessions.cockpitSessionId, cockpitSessionId));

    return {
      cockpitAgentId,
      cockpitSessionId,
      cockpitWorkspaceId: worktree.cockpitWorkspaceId,
      worktreePath: worktree.worktreePath,
      branch: worktree.branch,
    };
  });
}
