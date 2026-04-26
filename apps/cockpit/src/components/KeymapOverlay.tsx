import { useCockpitStore } from '../store/cockpitStore';

const ROWS: { keys: string; description: string }[] = [
  { keys: 'j / k', description: 'cycle focus through decisions' },
  { keys: 'a', description: 'approve focused decision' },
  { keys: 'b', description: 'block focused decision' },
  { keys: 'r', description: 'reply to focused decision' },
  { keys: '↵', description: 'open session detail for focused decision' },
  { keys: 'n', description: 'spawn new agent' },
  { keys: 'esc', description: 'close panel / form / clear focus' },
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
        className="w-[420px] rounded border border-border bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text">keyboard</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-text">
            ✕
          </button>
        </div>
        <ul className="space-y-1.5 text-xs">
          {ROWS.map((r) => (
            <li key={r.keys} className="flex items-baseline gap-3">
              <kbd className="min-w-[3.5rem] rounded border border-border bg-ink px-2 py-0.5 text-center font-mono text-[11px] text-text">
                {r.keys}
              </kbd>
              <span className="text-muted">{r.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
