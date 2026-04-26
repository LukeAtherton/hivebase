import { useCockpitStore } from '../store/cockpitStore';

const ROWS: { keys: string; description: string }[] = [
  { keys: 'j / k', description: 'cycle focus through decisions' },
  { keys: '⇧ J / K', description: 'cycle focus through agents (any state)' },
  { keys: 'l / h', description: 'open / close agent detail' },
  { keys: '↵ / a', description: 'approve focused decision' },
  { keys: 'i', description: 'redirect — opens detail + focuses textarea' },
  { keys: 'n', description: 'spawn new agent' },
  { keys: 'esc', description: 'cancel redirect / close panel / clear focus' },
  { keys: '?', description: 'toggle this overlay' },
];

export function KeymapOverlay() {
  const open = useCockpitStore((s) => s.keymapOpen);
  const setOpen = useCockpitStore((s) => s.setKeymapOpen);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="briefing-frame relative w-[460px] rounded-sm border border-border bg-panel p-5 animate-briefing-rise"
        style={{
          ['--briefing-bracket-color' as string]: 'rgba(125,211,252,0.5)',
          ['--briefing-bracket-size' as string]: '14px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="briefing-corners-tr" />
        <span className="briefing-corners-bl" />
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-accent/80">
              ▸ controls
            </div>
            <h2 className="mt-1 font-display text-[18px] uppercase leading-none tracking-[0.18em] text-text">
              keyboard
            </h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-text">
            ✕
          </button>
        </div>
        <ul className="space-y-1.5 text-xs">
          {ROWS.map((r) => (
            <li
              key={r.keys}
              className="flex items-baseline gap-3 border-b border-border/30 pb-1.5 last:border-b-0"
            >
              <kbd className="min-w-[3.5rem] rounded-sm border border-border bg-ink px-2 py-0.5 text-center font-mono text-[11px] text-text">
                {r.keys}
              </kbd>
              <span className="font-mono text-[11px] text-muted">{r.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
