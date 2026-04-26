// Territory intel — git state for the cockpit's hex-tile map.
//
// GET /sessions/:id/territory   one session's intel
// GET /territory                  all live sessions, in one call (used
//                                 by the canvas to lay out islands)
//
// Both routes are read-only and cached for ~3s in process. Pollers
// (the WS push loop in lib/territory-poller.ts) and direct fetchers
// share the cache.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  cockpitAgents,
  cockpitProjects,
  cockpitSessions,
  cockpitWorkspaces,
  getCockpitDb,
} from '@kybernos/platform';
import { readFileDiff, readSessionIntel, type SessionIntel } from '../lib/git-intel.js';

const CACHE_TTL_MS = 3_000;
const cache = new Map<string, { at: number; intel: SessionIntel }>();

interface SessionRow {
  cockpitSessionId: string;
  cockpitProjectId: string;
  worktreePath: string | null;
  branch: string | null;
  repoPath: string | null;
}

async function loadSessionRows(
  filter: { id?: string } = {},
): Promise<SessionRow[]> {
  const db = getCockpitDb();
  const q = db
    .select({
      cockpitSessionId: cockpitSessions.cockpitSessionId,
      cockpitProjectId: cockpitSessions.cockpitProjectId,
      worktreePath: cockpitWorkspaces.worktreePath,
      branch: cockpitWorkspaces.branch,
      repoPath: cockpitProjects.repoPath,
    })
    .from(cockpitSessions)
    .leftJoin(cockpitAgents, eq(cockpitAgents.cockpitAgentId, cockpitSessions.cockpitAgentId))
    .leftJoin(
      cockpitWorkspaces,
      eq(cockpitWorkspaces.cockpitWorkspaceId, cockpitAgents.cockpitWorkspaceId),
    )
    .leftJoin(
      cockpitProjects,
      eq(cockpitProjects.cockpitProjectId, cockpitSessions.cockpitProjectId),
    );

  const rows = filter.id
    ? await q.where(eq(cockpitSessions.cockpitSessionId, filter.id))
    : await q;
  return rows;
}

async function readIntelCached(row: SessionRow): Promise<SessionIntel | null> {
  if (!row.worktreePath || !row.branch || !row.repoPath) return null;
  const cached = cache.get(row.cockpitSessionId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.intel;
  const intel = await readSessionIntel({
    cockpitSessionId: row.cockpitSessionId,
    worktreePath: row.worktreePath,
    branch: row.branch,
    repoPath: row.repoPath,
  });
  cache.set(row.cockpitSessionId, { at: Date.now(), intel });
  return intel;
}

// Allow other modules (e.g. the poller) to invalidate cache entries
// when an event signals the worktree may have changed.
export function invalidateTerritoryCache(cockpitSessionId?: string): void {
  if (cockpitSessionId) cache.delete(cockpitSessionId);
  else cache.clear();
}

export async function registerTerritoryRoutes(app: FastifyInstance) {
  app.get('/sessions/:id/territory', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const rows = await loadSessionRows({ id });
    if (rows.length === 0) return reply.status(404).send({ error: 'unknown session' });
    const intel = await readIntelCached(rows[0]);
    if (!intel) return reply.status(404).send({ error: 'session has no worktree yet' });
    return intel;
  });

  app.get('/sessions/:id/diff', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const path = (req.query as { path?: string }).path;
    if (!path) return reply.status(400).send({ error: 'path query param required' });
    const rows = await loadSessionRows({ id });
    if (rows.length === 0) return reply.status(404).send({ error: 'unknown session' });
    const row = rows[0];
    if (!row.repoPath || !row.branch) {
      return reply.status(404).send({ error: 'session has no worktree' });
    }
    const diff = await readFileDiff({
      repoPath: row.repoPath,
      branch: row.branch,
      filePath: path,
    });
    return { path, diff };
  });

  app.get('/territory', async () => {
    const rows = await loadSessionRows();
    const out: SessionIntel[] = [];
    // Fan out reads in parallel — git calls are local + tiny per session.
    const results = await Promise.all(rows.map((r) => readIntelCached(r).catch(() => null)));
    for (const r of results) {
      if (r) out.push(r);
    }
    return { territories: out };
  });
}
