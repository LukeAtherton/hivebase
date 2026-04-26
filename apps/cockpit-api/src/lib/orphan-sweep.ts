import { and, inArray, isNull } from 'drizzle-orm';
import { getCockpitDb, cockpitSessions } from '@swarm/platform';

// On startup the api has no in-process SessionControllers, but the DB may
// still hold sessions in 'implementing' / 'orienting' / 'needs-decision'
// from before the last shutdown. Their claude child processes were SIGTERMed
// when the api died, so they're dead — we just never got to publish
// session.ended for them. Mark them stale-zombie so the map and outliner
// don't show them as live.
//
// Run once at startup. Conservative — only touches non-terminal states with
// no endedAt timestamp. Never resurrects something that's already terminal.
const ORPHAN_STATES = [
  'queued',
  'orienting',
  'implementing',
  'validating',
  'needs-decision',
  'blocked',
];

export async function sweepOrphanSessions(): Promise<{ swept: number }> {
  const db = getCockpitDb();
  const now = new Date().toISOString();
  const res = await db
    .update(cockpitSessions)
    .set({ state: 'stale-zombie', endedAt: now })
    .where(and(inArray(cockpitSessions.state, ORPHAN_STATES), isNull(cockpitSessions.endedAt)))
    .returning({ id: cockpitSessions.cockpitSessionId });
  return { swept: res.length };
}
