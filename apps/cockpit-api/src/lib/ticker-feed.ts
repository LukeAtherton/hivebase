// News-ticker feed.
//
// Subscribes to eventBus, filters down to the events the operator
// actually wants on a peripheral ticker (errors, notifications,
// session lifecycle, decision lifecycle, plan changes), and writes
// each one to a capped Redis list (cockpit:ticker, last 200).
//
// The frontend backfills via GET /ticker on mount, then receives live
// items over the existing /ws firehose using the same client-side
// predicate. Persistence here gives reload-survival + replay; live
// fan-out reuses the existing WS plumbing.

import Redis from 'ioredis';
import type { NormalisedEvent } from '@kybernos/core';
import { eventBus } from './event-bus.js';

const LIST_KEY = 'cockpit:ticker';
const MAX_ITEMS = 200;

export interface TickerItem {
  // ISO timestamp of when the underlying event occurred.
  ts: string;
  // Coarse classification used by the client to colour-code the strip.
  kind: 'error' | 'notification' | 'session' | 'decision' | 'plan';
  // Severity tier — required > advisory > info > none.
  severity?: 'required' | 'advisory' | 'info';
  // Human-readable line. Kept short — this scrolls past in a thin strip.
  message: string;
  // Optional links — clicking the item selects the agent.
  cockpitSessionId?: string;
  cockpitAgentId?: string;
}

let redis: Redis | null = null;
let started = false;

export function startTickerFeed(redisUrl: string): void {
  if (started) return;
  started = true;
  redis = new Redis(redisUrl, { lazyConnect: true });
  redis.connect().catch((err) => {
    console.error('[ticker] redis connect failed', err);
    started = false;
  });

  eventBus.on('event', onEvent);
  eventBus.on('decision-created', onDecisionCreated);
  eventBus.on('decision-resolved', onDecisionResolved);
}

export async function shutdownTickerFeed(): Promise<void> {
  if (!started) return;
  started = false;
  eventBus.off('event', onEvent);
  eventBus.off('decision-created', onDecisionCreated);
  eventBus.off('decision-resolved', onDecisionResolved);
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = null;
  }
}

export async function readTicker(limit: number): Promise<TickerItem[]> {
  if (!redis) return [];
  const n = Math.max(1, Math.min(MAX_ITEMS, limit));
  const raw = await redis.lrange(LIST_KEY, 0, n - 1);
  const out: TickerItem[] = [];
  for (const s of raw) {
    try {
      out.push(JSON.parse(s) as TickerItem);
    } catch {
      /* drop malformed entry */
    }
  }
  return out;
}

async function push(item: TickerItem): Promise<void> {
  if (!redis) return;
  try {
    await redis.lpush(LIST_KEY, JSON.stringify(item));
    await redis.ltrim(LIST_KEY, 0, MAX_ITEMS - 1);
  } catch {
    /* redis blip — drop the item rather than crash the bus */
  }
}

function onEvent(event: NormalisedEvent) {
  const item = classify(event);
  if (item) void push(item);
}

function onDecisionCreated(msg: unknown) {
  const m = (msg ?? {}) as {
    decisionId?: string;
    event?: NormalisedEvent;
    trigger?: { triggerType?: string; severity?: 'required' | 'advisory' | 'info' };
  };
  const trig = m.trigger?.triggerType?.replace(/-/g, ' ') ?? 'decision';
  const sev = m.trigger?.severity ?? 'info';
  void push({
    ts: m.event?.timestamp ?? new Date().toISOString(),
    kind: 'decision',
    severity: sev,
    message: `decision opened · ${trig}`,
    cockpitSessionId: m.event?.cockpitSessionId,
    cockpitAgentId: m.event?.cockpitAgentId,
  });
}

function onDecisionResolved(msg: unknown) {
  const m = (msg ?? {}) as {
    decisionId?: string;
    choice?: 'approve' | 'block' | 'reply' | 'expired' | string;
  };
  const choice = m.choice ?? 'resolved';
  void push({
    ts: new Date().toISOString(),
    kind: 'decision',
    severity: 'info',
    message: `decision ${choice}`,
  });
}

// Exported for tests. Pure: maps a normalised event to the ticker
// item the strip should render, or null if the event is not
// peripherally interesting (text deltas, tool noise, cost ticks).
export function classify(e: NormalisedEvent): TickerItem | null {
  switch (e.type) {
    case 'session.started':
      return {
        ts: e.timestamp,
        kind: 'session',
        message: 'session started',
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    case 'session.ended':
      return {
        ts: e.timestamp,
        kind: 'session',
        message: 'session ended',
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    case 'error': {
      const msg = (e.payload['message'] as string | undefined) ?? 'error';
      return {
        ts: e.timestamp,
        kind: 'error',
        severity: 'required',
        message: msg.slice(0, 140),
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    }
    case 'notification': {
      const msg = (e.payload['message'] as string | undefined) ?? 'notification';
      return {
        ts: e.timestamp,
        kind: 'notification',
        severity: 'advisory',
        message: msg.slice(0, 140),
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    }
    case 'plan.updated': {
      // Only surface the active task as it changes — pure plan churn
      // (re-ordering, marking pending) would flood the strip.
      const items = e.payload['items'] as { content?: string; activeForm?: string; status?: string }[] | undefined;
      const active = items?.find((it) => it.status === 'in_progress');
      if (!active) return null;
      const label = active.activeForm ?? active.content ?? '';
      if (!label) return null;
      return {
        ts: e.timestamp,
        kind: 'plan',
        message: `→ ${label.slice(0, 120)}`,
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    }
    default:
      return null;
  }
}
