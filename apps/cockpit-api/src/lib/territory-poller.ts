// Territory poller — periodically re-reads git intel for every live
// session and broadcasts a 'territory-updated' notification on the
// event bus when something changed (commits, files, merge status, PR).
//
// The frontend's territory queries refetch on this notification —
// keeps the canvas in sync with on-disk state without per-client
// fan-out of git commands.
//
// Cadence: 6s. Cheap on a quiet repo (one git rev-parse + diff per
// session). Pause-able for tests.

import { eq } from 'drizzle-orm';
import {
  cockpitAgents,
  cockpitProjects,
  cockpitSessions,
  cockpitWorkspaces,
  getCockpitDb,
} from '@kybernos/platform';
import { readSessionIntel, type SessionIntel } from './git-intel.js';
import { invalidateTerritoryCache } from '../routes/territory.js';
import { eventBus } from './event-bus.js';

const POLL_MS = 6_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

// Last seen "shape" hash per session. We don't ship the full intel on
// the bus — just say "this session's territory changed" — but we do
// want to suppress no-op pushes when nothing moved.
const lastShape = new Map<string, string>();

// Exported for tests. Hashes the things that move tiles on screen so
// we can suppress no-op pushes when the intel hasn't materially
// changed (e.g. timestamp jitter on worktree mtime alone).
export function shapeOf(intel: SessionIntel): string {
  // Hash the things that move tiles on screen: commit count + branch
  // head + merged flag + the sorted list of changed-file paths.
  const paths = intel.changedFiles
    .map((f) => f.path)
    .sort()
    .join('|');
  return [
    intel.commits.length,
    intel.branchHead ?? '',
    intel.merged ? '1' : '0',
    intel.pr?.state ?? '-',
    paths,
  ].join(';');
}

export function startTerritoryPoller(): void {
  if (running) return;
  running = true;
  const tick = async () => {
    if (!running) return;
    try {
      await pollOnce();
    } catch (err) {
      console.error('[territory-poller] tick failed', err);
    }
    if (running) timer = setTimeout(tick, POLL_MS);
  };
  // First tick on a short delay so startup has finished registering
  // routes / migrating db.
  timer = setTimeout(tick, 1_500);
}

export async function shutdownTerritoryPoller(): Promise<void> {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  lastShape.clear();
}

async function pollOnce(): Promise<void> {
  const rows = await loadLiveSessions();
  // Run intels in parallel — they're independent local-only commands.
  await Promise.all(
    rows.map(async (row) => {
      try {
        const intel = await readSessionIntel({
          cockpitSessionId: row.cockpitSessionId,
          worktreePath: row.worktreePath,
          branch: row.branch,
          repoPath: row.repoPath,
        });
        const shape = shapeOf(intel);
        const prev = lastShape.get(row.cockpitSessionId);
        if (prev !== shape) {
          lastShape.set(row.cockpitSessionId, shape);
          // Invalidate the route cache so the next refetch returns
          // fresh data, then notify clients to refetch.
          invalidateTerritoryCache(row.cockpitSessionId);
          eventBus.emit('territory-updated', {
            cockpitSessionId: row.cockpitSessionId,
            merged: intel.merged,
          });
        }
      } catch {
        /* per-session failure — keep going */
      }
    }),
  );
}

interface LiveSessionRow {
  cockpitSessionId: string;
  worktreePath: string;
  branch: string;
  repoPath: string;
}

async function loadLiveSessions(): Promise<LiveSessionRow[]> {
  const db = getCockpitDb();
  // Skip merged/stopped/stale-zombie — they don't change anymore.
  const rows = await db
    .select({
      cockpitSessionId: cockpitSessions.cockpitSessionId,
      state: cockpitSessions.state,
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

  const out: LiveSessionRow[] = [];
  for (const r of rows) {
    if (!r.worktreePath || !r.branch || !r.repoPath) continue;
    if (['stopped', 'merged', 'stale-zombie'].includes(r.state ?? '')) continue;
    out.push({
      cockpitSessionId: r.cockpitSessionId,
      worktreePath: r.worktreePath,
      branch: r.branch,
      repoPath: r.repoPath,
    });
  }
  return out;
}
