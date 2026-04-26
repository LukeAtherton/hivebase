import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { useLiveStream } from './lib/useLiveStream';
import { useKeymap } from './lib/useKeymap';
import { useCockpitStore } from './store/cockpitStore';
import { PortfolioMap } from './scene/PortfolioMap';
import { MapHUD } from './components/SummaryLine';
import { DecisionQueue } from './components/DecisionQueue';
import { SessionDetail } from './components/SessionDetail';
import { SpawnModal } from './components/SpawnModal';
import { ScopingSurface } from './components/ScopingSurface';
import { KeymapOverlay } from './components/KeymapOverlay';
import { NewsTicker } from './components/NewsTicker';
import { TileDetail } from './components/TileDetail';
import { Toasts } from './components/Toasts';

export function App() {
  useLiveStream();

  // Deep-link: ?session=ckse_... selects that session on first mount.
  // Used by the audit canvas's "open in cockpit" links and the snapshot
  // pipeline to drive the cockpit into a specific seeded state.
  const setSelected = useCockpitStore((s) => s.setSelected);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) setSelected(sessionParam);
  }, [setSelected]);

  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.listSessions(),
    refetchInterval: 10_000,
  });
  const decisionsQ = useQuery({
    queryKey: ['decisions', 'open'],
    queryFn: () => api.listDecisions('open'),
    refetchInterval: 10_000,
  });

  const sessions = sessionsQ.data?.sessions ?? [];
  const decisions = decisionsQ.data?.decisions ?? [];

  // Keymap reads decision list (j/k) and session list (shift+j/k).
  useKeymap(decisions, sessions);

  const selectedId = useCockpitStore((s) => s.selectedSessionId);
  const spawnModalOpen = useCockpitStore((s) => s.spawnModalOpen);
  const setSpawnModal = useCockpitStore((s) => s.setSpawnModal);
  const scopingSurfaceOpen = useCockpitStore((s) => s.scopingSurfaceOpen);
  const setScopingSurface = useCockpitStore((s) => s.setScopingSurface);
  const selectedSession = selectedId
    ? (sessions.find((s) => s.cockpitSessionId === selectedId) ?? null)
    : null;
  const selectedTile = useCockpitStore((s) => s.selectedTile);

  // Floating-panels layout: the canvas fills the whole viewport. The
  // decision queue floats over the top-left when there are decisions,
  // and SessionDetail floats adjacent when an agent is selected. The
  // canvas camera applies an xBias so agents stay visible to the right
  // of the floating panels (no agents hidden under cards).
  const queueVisible = decisions.length > 0;
  const detailVisible = !!selectedSession;
  // Bias is in world units. The canvas viewport spans ~scene-radius
  // worth of world space horizontally; ~3 units of right-shift moves
  // the cluster cleanly out of the floating panels' shadow.
  const xBias = (queueVisible ? 1.6 : 0) + (detailVisible ? 1.6 : 0);
  // Floating-panel widths in screen pixels. Used by the HUD to
  // re-centre on the visible canvas region rather than the viewport.
  // Layout: 24px edges, 16px gap between queue and detail.
  const queueOuterPx = queueVisible ? 24 + 420 : 0;
  const detailOuterPx = detailVisible ? (queueVisible ? 16 + 480 : 24 + 480) : 0;
  const panelsRightPx = queueOuterPx + detailOuterPx;

  return (
    <div className="relative flex h-full flex-col">
      <div className="relative flex-1 overflow-hidden">
        {/* Full-bleed canvas. */}
        <div data-audit-id="portfolio-map" className="absolute inset-0">
          <PortfolioMap sessions={sessions} xBias={xBias} />
        </div>

        {/* HUD — floats centred on the visible canvas region (the
            viewport less the floating panels). When the queue and
            detail are open it slides right so it doesn't overlap them.
            CSS-only animated transform. */}
        <div
          className="pointer-events-none absolute left-1/2 top-6 z-20 transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(calc(-50% + ${panelsRightPx / 2}px))`,
          }}
        >
          <MapHUD decisions={decisions} sessions={sessions} />
        </div>

        {/* Decision queue — floats over the left strip when there's
            something to act on. Hidden entirely when the queue is
            empty (calm canvas). */}
        {queueVisible && (
          <div
            data-audit-id="queue-floater"
            className="pointer-events-auto absolute bottom-[54px] left-6 top-6 z-10 w-[420px]"
          >
            <DecisionQueue decisions={decisions} sessions={sessions} />
          </div>
        )}

        {/* SessionDetail — floats just right of the queue (or against the
            left edge when there's no queue) when an agent is selected. */}
        {detailVisible && selectedSession && (
          <div
            data-audit-id="detail-floater"
            className="pointer-events-auto absolute bottom-[54px] top-6 z-10 w-[480px] overflow-hidden rounded-md border border-border/60 bg-panel/90 shadow-[0_4px_28px_rgba(0,0,0,0.5)] backdrop-blur-md"
            style={{ left: queueVisible ? '460px' : '24px' }}
          >
            <SessionDetail session={selectedSession} />
          </div>
        )}
        {/* Tile detail — floats against the right edge, independent of
            queue + session-detail panels. Coexists with all of them. */}
        {selectedTile && (
          <div
            data-audit-id="tile-floater"
            className="pointer-events-auto absolute bottom-[54px] right-6 top-6 z-10 w-[560px] overflow-hidden rounded-md border border-fuchsia-500/30 bg-panel/95 shadow-[0_4px_28px_rgba(0,0,0,0.5)] backdrop-blur-md"
          >
            <TileDetail
              cockpitSessionId={selectedTile.cockpitSessionId}
              filePath={selectedTile.filePath}
            />
          </div>
        )}
        {/* News ticker — bottom strip, peripheral attention surface. */}
        <NewsTicker />
      </div>
      {spawnModalOpen && <SpawnModal onClose={() => setSpawnModal(false)} />}
      {scopingSurfaceOpen && <ScopingSurface onClose={() => setScopingSurface(false)} />}
      <KeymapOverlay />
      <Toasts />
    </div>
  );
}
