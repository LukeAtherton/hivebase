import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCockpitStore } from '../store/cockpitStore';

// Single WS connection. Any cockpit message invalidates the relevant query.
// Phase 1 is stupidly simple — refetch on the firehose. Optimise per-row
// caching once a slow path appears.
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
        } else if (parsed.kind === 'decision-created' || parsed.kind === 'decision-resolved') {
          qc.invalidateQueries({ queryKey: ['decisions'] });
          qc.invalidateQueries({ queryKey: ['sessions'] });
        }
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [qc]);
}
