import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from './lib/api';
import { useLiveStream } from './lib/useLiveStream';
import { useKeymap } from './lib/useKeymap';
import { useCockpitStore } from './store/cockpitStore';
import { PortfolioMap } from './scene/PortfolioMap';
import { SummaryLine } from './components/SummaryLine';
import { DecisionQueue } from './components/DecisionQueue';
import { SessionOutliner } from './components/SessionOutliner';
import { SessionDetail } from './components/SessionDetail';
import { SpawnModal } from './components/SpawnModal';
import { KeymapOverlay } from './components/KeymapOverlay';
import { Toasts } from './components/Toasts';

export function App() {
  useLiveStream();

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

  // Keymap reads decision list to drive j/k focus cycling.
  useKeymap(decisions);

  const selectedId = useCockpitStore((s) => s.selectedSessionId);
  const spawnModalOpen = useCockpitStore((s) => s.spawnModalOpen);
  const setSpawnModal = useCockpitStore((s) => s.setSpawnModal);
  const setKeymapOpen = useCockpitStore((s) => s.setKeymapOpen);
  const selectedSession = selectedId
    ? (sessions.find((s) => s.cockpitSessionId === selectedId) ?? null)
    : null;

  // Master caution: red pulse if anything truly demands attention
  // (required-severity open decision, or session blocked/needs-decision).
  // Otherwise amber pulse if only advisory decisions are open. Otherwise quiet.
  const requiredOpen = decisions.some((d) => d.severity === 'required');
  const advisoryOpen = decisions.some((d) => d.severity === 'advisory');
  const anyBlocked = sessions.some((s) => s.state === 'needs-decision' || s.state === 'blocked');
  const cautionLevel = requiredOpen || anyBlocked ? 'red' : advisoryOpen ? 'amber' : 'none';

  return (
    <div
      className={clsx(
        'flex h-full flex-col',
        cautionLevel === 'red' && 'animate-caution-pulse',
        cautionLevel === 'amber' && 'animate-warn-pulse',
      )}
    >
      <SummaryLine sessions={sessions} decisions={decisions} />
      <div className="grid flex-1 grid-cols-[1fr_380px] overflow-hidden">
        <div
          className="relative grid overflow-hidden"
          style={{
            // Decision queue grows with queue depth, but never below 240px nor
            // taller than 55vh (so the map always remains the dominant view).
            // Vision: queue is the primary work surface, but the spatial
            // overview is the orienting surface.
            gridTemplateRows:
              decisions.length === 0
                ? 'minmax(0, 1fr) 220px'
                : decisions.length <= 2
                  ? 'minmax(0, 1fr) minmax(280px, 38vh)'
                  : 'minmax(0, 1fr) minmax(360px, 55vh)',
          }}
        >
          <div className="relative overflow-hidden">
            <PortfolioMap sessions={sessions} />
            <button
              onClick={() => setSpawnModal(true)}
              className="absolute left-3 top-3 rounded border border-accent/60 bg-panel/80 px-3 py-1 text-xs uppercase tracking-widest text-accent backdrop-blur hover:bg-accent/10"
            >
              + spawn
            </button>
            <button
              onClick={() => setKeymapOpen(true)}
              className="absolute right-3 top-3 rounded border border-border bg-panel/80 px-2 py-1 text-[10px] text-muted backdrop-blur hover:text-text"
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>
            {/* Detail panel floats inside the map cell only — it never spills
                over the decision queue below. Stellaris pattern: clicking a
                planet pops a window over the galaxy view, but the production
                queue at the bottom stays fully clickable. */}
            {selectedSession && (
              <div className="absolute inset-0 z-20 flex items-stretch justify-end p-3 pointer-events-none">
                <div className="pointer-events-auto h-full w-[480px] max-w-full rounded border border-accent/30 bg-panel/95 shadow-[0_0_36px_rgba(125,211,252,0.15)] backdrop-blur">
                  <SessionDetail session={selectedSession} />
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-border bg-panel/40">
            <DecisionQueue decisions={decisions} sessions={sessions} />
          </div>
        </div>
        <SessionOutliner sessions={sessions} />
      </div>
      {spawnModalOpen && <SpawnModal onClose={() => setSpawnModal(false)} />}
      <KeymapOverlay />
      <Toasts />
    </div>
  );
}
