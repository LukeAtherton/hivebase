import { useEffect } from 'react';
import clsx from 'clsx';
import { useCockpitStore } from '../store/cockpitStore';

const AUTO_DISMISS_MS = 6000;

export function Toasts() {
  const toasts = useCockpitStore((s) => s.toasts);
  const dismiss = useCockpitStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed right-4 top-12 z-40 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} text={t.text} kind={t.kind} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  text,
  kind,
  onDismiss,
}: {
  text: string;
  kind: 'error' | 'info';
  onDismiss: () => void;
}) {
  useEffect(() => {
    const handle = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(handle);
  }, [onDismiss]);

  return (
    <div
      className={clsx(
        'pointer-events-auto max-w-[360px] rounded border px-3 py-2 text-xs shadow-lg backdrop-blur',
        kind === 'error'
          ? 'border-alarm/60 bg-alarm/15 text-text'
          : 'border-border bg-panel/90 text-text',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 break-words">{text}</span>
        <button onClick={onDismiss} className="text-muted hover:text-text">
          ✕
        </button>
      </div>
    </div>
  );
}
