import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCockpitStore } from '../store/cockpitStore';
import type { TickerItem } from './api';

// Single WS connection. Any cockpit message invalidates the relevant query.
// Phase 1 is stupidly simple — refetch on the firehose. Optimise per-row
// caching once a slow path appears.
//
// Side-effect: the news-ticker component listens on `cockpit:ticker-item`
// for live additions. We classify the firehose with the same predicate
// the server uses (lib/ticker-feed.ts) so the rendered ticker stays in
// sync between reload (backfill from /ticker) and live (this stream).
export function useLiveStream() {
  const qc = useQueryClient();
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    const recordEvent = useCockpitStore.getState().recordEvent;
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.kind === 'event') {
          recordEvent();
          qc.invalidateQueries({ queryKey: ['sessions'] });
          // Per-session event timeline (used by the detail panel).
          const sid = parsed.event?.cockpitSessionId;
          if (sid) qc.invalidateQueries({ queryKey: ['session-events', sid] });
          const item = classifyForTicker(parsed.event);
          if (item) emitTickerItem(item);
        } else if (parsed.kind === 'decision-created') {
          qc.invalidateQueries({ queryKey: ['decisions'] });
          qc.invalidateQueries({ queryKey: ['sessions'] });
          emitTickerItem({
            ts: parsed.event?.timestamp ?? new Date().toISOString(),
            kind: 'decision',
            severity: parsed.trigger?.severity ?? 'info',
            message: `decision opened · ${(parsed.trigger?.triggerType ?? 'decision').replace(/-/g, ' ')}`,
            cockpitSessionId: parsed.event?.cockpitSessionId,
            cockpitAgentId: parsed.event?.cockpitAgentId,
          });
        } else if (parsed.kind === 'decision-resolved') {
          qc.invalidateQueries({ queryKey: ['decisions'] });
          qc.invalidateQueries({ queryKey: ['sessions'] });
          emitTickerItem({
            ts: new Date().toISOString(),
            kind: 'decision',
            severity: 'info',
            message: `decision ${parsed.choice ?? 'resolved'}`,
          });
        } else if (parsed.kind === 'territory-updated') {
          // Refetch the canvas's territory data when the poller flags
          // a real change (commits / files / merge / PR).
          qc.invalidateQueries({ queryKey: ['territory'] });
          if (parsed.cockpitSessionId) {
            qc.invalidateQueries({
              queryKey: ['session-territory', parsed.cockpitSessionId],
            });
          }
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [qc]);
}

// Mirrors apps/cockpit-api/src/lib/ticker-feed.ts:classify. Kept in sync
// by hand — this is a tiny pure function with zero hidden state.
function classifyForTicker(e: {
  type?: string;
  timestamp?: string;
  cockpitSessionId?: string;
  cockpitAgentId?: string;
  payload?: Record<string, unknown>;
}): TickerItem | null {
  if (!e || !e.type) return null;
  const ts = e.timestamp ?? new Date().toISOString();
  switch (e.type) {
    case 'session.started':
      return {
        ts,
        kind: 'session',
        message: 'session started',
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    case 'session.ended':
      return {
        ts,
        kind: 'session',
        message: 'session ended',
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    case 'error': {
      const msg = (e.payload?.['message'] as string | undefined) ?? 'error';
      return {
        ts,
        kind: 'error',
        severity: 'required',
        message: msg.slice(0, 140),
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    }
    case 'notification': {
      const msg = (e.payload?.['message'] as string | undefined) ?? 'notification';
      return {
        ts,
        kind: 'notification',
        severity: 'advisory',
        message: msg.slice(0, 140),
        cockpitSessionId: e.cockpitSessionId,
        cockpitAgentId: e.cockpitAgentId,
      };
    }
    case 'plan.updated': {
      const items = e.payload?.['items'] as
        | { content?: string; activeForm?: string; status?: string }[]
        | undefined;
      const active = items?.find((it) => it.status === 'in_progress');
      if (!active) return null;
      const label = active.activeForm ?? active.content ?? '';
      if (!label) return null;
      return {
        ts,
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

function emitTickerItem(item: TickerItem) {
  window.dispatchEvent(new CustomEvent('cockpit:ticker-item', { detail: item }));
}
