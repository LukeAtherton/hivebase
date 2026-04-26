import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getCockpitDb, cockpitProjects } from '@kybernos/platform';
import { generateCockpitProjectId } from '@kybernos/ids';

const CreateProjectBody = z.object({
  name: z.string().min(1),
  kind: z.enum(['local-repo', 'hivescaler']),
  repoPath: z.string().optional(),
  hivescalerProjectId: z.string().optional(),
  workspaceId: z.string(),
  createdBy: z.string(),
});

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get('/projects', async () => {
    const rows = await getCockpitDb().select().from(cockpitProjects);
    return { projects: rows };
  });

  app.post('/projects', async (req, reply) => {
    const body = CreateProjectBody.parse(req.body);
    if (body.kind === 'local-repo' && !body.repoPath) {
      return reply.status(400).send({ error: 'local-repo project requires repoPath' });
    }
    if (body.kind === 'hivescaler' && !body.hivescalerProjectId) {
      return reply.status(400).send({ error: 'hivescaler project requires hivescalerProjectId' });
    }
    const cockpitProjectId = generateCockpitProjectId();
    const now = new Date().toISOString();
    await getCockpitDb().insert(cockpitProjects).values({
      cockpitProjectId,
      workspaceId: body.workspaceId,
      name: body.name,
      kind: body.kind,
      repoPath: body.repoPath,
      hivescalerProjectId: body.hivescalerProjectId,
      createdAt: now,
      createdBy: body.createdBy,
    });
    return { cockpitProjectId };
  });

  app.get('/projects/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const [row] = await getCockpitDb()
      .select()
      .from(cockpitProjects)
      .where(eq(cockpitProjects.cockpitProjectId, id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'not found' });
    return row;
  });
}
