import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { PlanItem, SessionRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';

const STATE_BADGE: Record<string, string> = {
  queued: 'text-muted',
  orienting: 'text-accent',
  implementing: 'text-ok',
  validating: 'text-ok',
  blocked: 'text-alarm',
  'needs-decision': 'text-warn',
  'ready-for-review': 'text-accent',
  stopped: 'text-muted',
};

export function SessionOutliner({ sessions }: { sessions: SessionRow[] }) {
  const selected = useCockpitStore((s) => s.selectedSessionId);
  const setSelected = useCockpitStore((s) => s.setSelected);

  // Group by project for the Stellaris-style tree.
  const byProject = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = byProject.get(s.cockpitProjectId) ?? [];
    list.push(s);
    byProject.set(s.cockpitProjectId, list);
  }

  return (
    <div data-audit-id="outliner" className="flex h-full flex-col overflow-y-auto border-l border-border bg-panel/60">
      <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wide text-muted">
        outliner
      </div>
      {Array.from(byProject.entries()).map(([projectId, rows]) => (
        <div key={projectId} className="border-b border-border px-2 py-2">
          <div className="px-1 text-[10px] uppercase tracking-widest text-muted">
            {rows[0]?.projectName ?? projectId.slice(-8)}
          </div>
          {rows.map((s) => (
            <SessionRow
              key={s.cockpitSessionId}
              session={s}
              selected={selected === s.cockpitSessionId}
              onSelect={setSelected}
            />
          ))}
        </div>
      ))}
      {sessions.length === 0 && <div className="px-3 py-4 text-xs text-muted">no sessions yet</div>}
    </div>
  );
}

function SessionRow({
  session: s,
  selected,
  onSelect,
}: {
  session: SessionRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const todos = s.currentTodos ?? null;
  const counts = todos ? countTodos(todos) : null;

  // Activity flash: briefly glow the row when lastEventAt changes — peripheral
  // signal that this agent just did something. Calm-tech principle: visible
  // but not distracting (300ms cyan flash, fades out). Uses a one-shot
  // useEffect that compares against a stored prev value.
  const prevLast = useRef<string | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevLast.current !== null && s.lastEventAt && s.lastEventAt !== prevLast.current) {
      setFlash(true);
      const handle = window.setTimeout(() => setFlash(false), 600);
      prevLast.current = s.lastEventAt;
      return () => window.clearTimeout(handle);
    }
    prevLast.current = s.lastEventAt;
  }, [s.lastEventAt]);

  return (
    <div
      data-audit-session-id={s.cockpitSessionId}
      className={clsx(
        'mt-1 rounded transition-colors duration-500',
        selected && 'bg-border/60',
        flash && 'bg-accent/20',
      )}
    >
      <button
        onClick={() => onSelect(s.cockpitSessionId)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-border/40"
      >
        <span
          className={clsx(
            'inline-block h-1.5 w-1.5 rounded-full',
            STATE_BADGE[s.state] ?? 'text-muted',
            flash && 'shadow-[0_0_6px_currentColor]',
          )}
          style={{ background: 'currentColor' }}
        />
        <span className="min-w-0 flex-1 truncate text-text">
          {s.agentLabel ?? s.cockpitSessionId.slice(-8)}
        </span>
        {counts && (
          <span className="text-[10px] text-muted">
            {counts.done}/{counts.total}
          </span>
        )}
        <span className={clsx('text-[10px]', STATE_BADGE[s.state])}>{s.state}</span>
      </button>
      {selected && todos && todos.length > 0 && <PlanList items={todos} />}
    </div>
  );
}

function PlanList({ items }: { items: PlanItem[] }) {
  return (
    <ul className="space-y-0.5 px-3 pb-2 text-[11px]">
      {items.map((item, i) => (
        <li
          key={i}
          className={clsx(
            'flex items-start gap-2',
            item.status === 'completed' && 'text-muted line-through',
            item.status === 'in_progress' && 'text-accent',
            item.status === 'pending' && 'text-text/80',
          )}
        >
          <span className="mt-[3px] inline-block h-1 w-1 shrink-0 rounded-full bg-current" />
          <span className="min-w-0">
            {item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

function countTodos(items: PlanItem[]): { done: number; total: number } {
  return {
    done: items.filter((i) => i.status === 'completed').length,
    total: items.length,
  };
}
