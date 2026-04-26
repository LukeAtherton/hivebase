// Cooldown scheduler. Decisions with an `expiresAt` get their id pushed onto
// a Redis sorted set scored by expiry timestamp (ms). A blocking BZPOPMIN
// loop pops the next-due entry and applies the decision's `defaultChoice`.
//
// Why Redis vs setTimeout: survives cockpit-api restart for any decision the
// adapter wrote before the crash, and gives sub-second granularity without
// per-decision setTimeout bookkeeping.
//
// Single-process loop for now. If we run multiple cockpit-api replicas, this
// keeps working — BZPOPMIN's blocking pop is exclusive across consumers.

import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import {
  cockpitDecisions,
  cockpitDecisionLedger,
  getCockpitDb,
} from '@swarm/platform';
import { generateCockpitLedgerId } from '@swarm/ids';
import { eventBus } from './event-bus.js';
import { getController, type ResolverChoice } from '../runtime/SessionController.js';

const ZSET_KEY = 'cockpit:cooldowns';

let redis: Redis | null = null;
let blockingRedis: Redis | null = null;
let running = false;

export function startCooldownScheduler(redisUrl: string): void {
  if (running) return;
  running = true;
  redis = new Redis(redisUrl, { lazyConnect: true });
  blockingRedis = new Redis(redisUrl, { lazyConnect: true });
  void Promise.all([redis.connect(), blockingRedis.connect()])
    .then(() => loop())
    .catch((err) => {
      console.error('[cooldown] failed to start', err);
      running = false;
    });
}

export async function scheduleCooldown(decisionId: string, expiresAt: Date): Promise<void> {
  if (!redis) return;
  await redis.zadd(ZSET_KEY, expiresAt.getTime(), decisionId);
}

export async function cancelCooldown(decisionId: string): Promise<void> {
  if (!redis) return;
  await redis.zrem(ZSET_KEY, decisionId);
}

async function loop(): Promise<void> {
  while (running && blockingRedis) {
    try {
      // Peek at next entry, sleep until its expiry, then pop.
      const next = await blockingRedis.zrange(ZSET_KEY, 0, 0, 'WITHSCORES');
      if (next.length < 2) {
        await sleep(2000);
        continue;
      }
      const [decisionId, scoreStr] = next;
      const dueAt = Number(scoreStr);
      const wait = Math.max(0, dueAt - Date.now());
      if (wait > 0) {
        // Wait for either timer or a poke (in case a sooner expiry was added).
        // Cheap: just sleep up to 2s and re-check; new entries will be earlier.
        await sleep(Math.min(wait, 2000));
        continue;
      }
      // Atomically remove and act. If ZREM returns 0, someone else already
      // claimed it — skip.
      const removed = await blockingRedis.zrem(ZSET_KEY, decisionId);
      if (removed === 0) continue;
      await applyDefault(decisionId);
    } catch (err) {
      console.error('[cooldown] loop error', err);
      await sleep(1000);
    }
  }
}

async function applyDefault(decisionId: string): Promise<void> {
  const db = getCockpitDb();
  const [row] = await db
    .select()
    .from(cockpitDecisions)
    .where(eq(cockpitDecisions.cockpitDecisionId, decisionId))
    .limit(1);
  if (!row || row.status !== 'open') return;
  const def = row.defaultChoice;
  const now = new Date().toISOString();
  // 'dismiss' = no agent action needed (info severity); just close the row.
  if (def === 'dismiss' || !def) {
    await db
      .update(cockpitDecisions)
      .set({ status: 'expired', resolvedAt: now, resolvedBy: 'cooldown' })
      .where(eq(cockpitDecisions.cockpitDecisionId, decisionId));
    eventBus.emit('decision-resolved', { decisionId, choice: 'expired' });
    return;
  }
  // For approve/block/reply: write the ledger entry and resolve the controller.
  const choice: 'approved' | 'blocked' | 'replied' =
    def === 'approve' ? 'approved' : def === 'reply' ? 'replied' : 'blocked';
  await db
    .update(cockpitDecisions)
    .set({ status: choice, resolvedAt: now, resolvedBy: 'cooldown' })
    .where(eq(cockpitDecisions.cockpitDecisionId, decisionId));
  await db.insert(cockpitDecisionLedger).values({
    cockpitLedgerId: generateCockpitLedgerId(),
    cockpitDecisionId: row.cockpitDecisionId,
    cockpitSessionId: row.cockpitSessionId,
    cockpitAgentId: row.cockpitAgentId,
    triggerType: row.triggerType,
    question: row.question,
    choice,
    reply: row.defaultReply ?? undefined,
    reason: 'cooldown-default',
    decidedAt: now,
    decidedBy: 'cooldown',
  });
  const controller = getController(row.cockpitSessionId);
  if (controller) {
    const resolverChoice: ResolverChoice =
      choice === 'approved'
        ? { kind: 'approved' }
        : choice === 'replied'
          ? { kind: 'replied', reply: row.defaultReply ?? '' }
          : { kind: 'blocked', message: 'cooldown default', interrupt: true };
    controller.resolve(decisionId, resolverChoice);
  }
  eventBus.emit('decision-resolved', { decisionId, choice });
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export async function shutdownCooldownScheduler(): Promise<void> {
  running = false;
  await Promise.all([redis?.quit(), blockingRedis?.quit()]);
  redis = null;
  blockingRedis = null;
}
