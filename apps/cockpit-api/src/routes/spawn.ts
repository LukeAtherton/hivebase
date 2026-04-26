import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClaudeCodeLocalAdapter } from '../adapters/claude-code/adapter.js';
import { spawnAgentWithPolicy, SpawnError } from '../lib/spawn-helpers.js';
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
  // for future cloud-billed agent types — see COCKPIT_PLAN.md
  // "Local adapter mechanism" for the rationale.
  const adapter = new ClaudeCodeLocalAdapter(config.hookEndpointUrl);

  app.post('/spawn', async (req, reply) => {
    const body = SpawnBody.parse(req.body);
    try {
      const result = await spawnAgentWithPolicy({
        cockpitProjectId: body.cockpitProjectId,
        task: body.task,
        // /spawn is the legacy route (pre-scoping-stage). It always
        // launches into implementation per the original cockpit-plan.
        // /scope/start is the modern entry point — this route stays
        // wired until step 4 cuts SpawnModal.
        stage: 'implementation',
        branch: body.branch,
        baseBranch: body.baseBranch,
        label: body.label,
        adapter,
      });
      return result;
    } catch (err) {
      if (err instanceof SpawnError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
  });
}
