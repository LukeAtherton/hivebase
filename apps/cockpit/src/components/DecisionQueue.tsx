import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type DecisionRow, type SessionRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';
import { useCooldown } from '../lib/useCooldown';

// Decision queue — the primary work surface. Stellaris production-queue /
// SupCom command-bar feel: each card is a chunky command tile with a left
// severity column and a right body + button bank. When the queue is empty,
// surface live-fleet status instead of a thin "quiet" message.

const SEVERITY_STYLE: Record<DecisionRow['severity'], string> = {
  required: 'border-alarm/60 bg-alarm/[0.07]',
  advisory: 'border-warn/60 bg-warn/[0.05]',
  info: 'border-border bg-panel',
};

const SEVERITY_BAR: Record<DecisionRow['severity'], string> = {
  required: 'bg-alarm',
  advisory: 'bg-warn',
  info: 'bg-accent',
};

const SEVERITY_GLYPH: Record<DecisionRow['severity'], string> = {
  required: '▲',
  advisory: '◐',
  info: '•',
};

const SEVERITY_LABEL: Record<DecisionRow['severity'], string> = {
  required: 'REQ',
  advisory: 'ADV',
  info: 'INFO',
};

const SEVERITY_FG: Record<DecisionRow['severity'], string> = {
  required: 'text-alarm',
  advisory: 'text-warn',
  info: 'text-accent',
};

export function DecisionQueue({
  decisions,
  sessions,
}: {
  decisions: DecisionRow[];
  sessions: SessionRow[];
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between border-b border-border bg-ink/40 px-4 py-1.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
          decision queue
        </div>
        <div className="font-mono text-[10px] tracking-wider text-muted">
          {decisions.length === 0 ? 'standby' : `${decisions.length} open · oldest first`}
        </div>
      </div>
      {decisions.length === 0 ? (
        <FleetStandby sessions={sessions} />
      ) : (
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
          {decisions.map((d) => (
            <DecisionCard key={d.cockpitDecisionId} decision={d} sessions={sessions} />
          ))}
        </div>
      )}
    </div>
  );
}

function FleetStandby({ sessions }: { sessions: SessionRow[] }) {
  // Surface live-fleet posture when the queue is empty. Vision: situation log
  // > notification feed. This is a lightweight precursor — long-running
  // situations as durable objects (cockpit_situations) come in a later cycle.
  const liveByProject = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    if (['stopped', 'merged'].includes(s.state)) continue;
    const project = s.projectName ?? s.cockpitProjectId.slice(-6);
    const list = liveByProject.get(project) ?? [];
    list.push(s);
    liveByProject.set(project, list);
  }
  const projects = Array.from(liveByProject.entries()).sort();

  if (projects.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
        — fleet idle —
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 font-mono text-[11px]">
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted">
        all systems nominal · live agents per territory
      </div>
      <div className="grid grid-cols-2 gap-2">
        {projects.map(([project, list]) => (
          <div key={project} className="rounded border border-border bg-ink/40 px-3 py-2 text-text">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted">{project}</div>
            <div className="mt-1 text-lg tabular-nums text-text">
              {list.length}
              <span className="ml-1 text-[10px] uppercase tracking-widest text-muted">live</span>
            </div>
            <div className="mt-1 text-[10px] text-muted">{summariseStates(list)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function summariseStates(sessions: SessionRow[]): string {
  const counts: Record<string, number> = {};
  for (const s of sessions) counts[s.state] = (counts[s.state] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');
}

function DecisionCard({
  decision: d,
  sessions,
}: {
  decision: DecisionRow;
  sessions: SessionRow[];
}) {
  const qc = useQueryClient();
  const setSelected = useCockpitStore((s) => s.setSelected);
  const setFocusedDecision = useCockpitStore((s) => s.setFocusedDecision);
  const focused = useCockpitStore((s) => s.focusedDecisionId === d.cockpitDecisionId);
  const [hovered, setHovered] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onOpenReply(e: Event) {
      const detail = (e as CustomEvent<{ decisionId: string }>).detail;
      if (detail?.decisionId === d.cockpitDecisionId) {
        setReplyOpen(true);
        // Same as click-to-reply: select session so the detail panel + tile
        // dolly fire and the operator has context for the reply.
        setSelected(d.cockpitSessionId);
      }
    }
    window.addEventListener('cockpit:open-reply', onOpenReply);
    return () => window.removeEventListener('cockpit:open-reply', onOpenReply);
  }, [d.cockpitDecisionId, d.cockpitSessionId, setSelected]);

  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // Auto-select the focused decision's session — pulls the detail panel
      // open with that agent's transcript + plan + cost. Operator can't
      // make an informed call without context. Stellaris pattern: clicking
      // an alert teleports you to the system. Same for j/k keyboard nav.
      setSelected(d.cockpitSessionId);
    }
  }, [focused, d.cockpitSessionId, setSelected]);

  const approve = useMutation({
    mutationFn: (id: string) => api.approve(id, 'me'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions'] }),
  });
  const block = useMutation({
    mutationFn: (id: string) => api.block(id, 'me'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions'] }),
  });
  const reply = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.reply(id, 'me', text),
    onSuccess: () => {
      setReplyOpen(false);
      setReplyText('');
      qc.invalidateQueries({ queryKey: ['decisions'] });
    },
  });

  const cooldown = useCooldown(d.createdAt, d.expiresAt);
  const engaged = hovered || replyOpen;
  const displayed = engaged && cooldown !== null && cooldown < 1 ? null : cooldown;

  const isDefault = (action: 'approve' | 'block' | 'reply') => d.defaultChoice === action;
  const session = sessions.find((s) => s.cockpitSessionId === d.cockpitSessionId);
  const project = session?.projectName ?? d.cockpitSessionId.slice(-6);
  const agent = session?.agentLabel ?? d.cockpitSessionId.slice(-6);

  return (
    <div
      ref={cardRef}
      className={clsx(
        'relative grid grid-cols-[64px_1fr_auto] gap-3 overflow-hidden rounded border px-0 py-0 transition-[outline,transform]',
        SEVERITY_STYLE[d.severity],
        focused && 'outline outline-2 outline-offset-[-2px] outline-accent',
      )}
      onClick={() => {
        setFocusedDecision(d.cockpitDecisionId);
        setSelected(d.cockpitSessionId);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left command-panel column */}
      <div
        className={clsx(
          'flex flex-col items-center justify-center gap-1 border-r border-border/60 px-1 py-3',
          d.severity === 'required' && 'bg-alarm/10',
          d.severity === 'advisory' && 'bg-warn/10',
        )}
      >
        <span className={clsx('text-2xl leading-none', SEVERITY_FG[d.severity])} aria-hidden>
          {SEVERITY_GLYPH[d.severity]}
        </span>
        <span className={clsx('font-mono text-[9px] tracking-[0.2em]', SEVERITY_FG[d.severity])}>
          {SEVERITY_LABEL[d.severity]}
        </span>
        {d.expiresAt && cooldown !== null && cooldown < 1 && (
          <span className="font-mono text-[9px] text-muted">{humanRemaining(d.expiresAt)}</span>
        )}
      </div>

      {/* Right body */}
      <div className="min-w-0 flex flex-col justify-center py-2 pr-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          <span className="text-text/80">{project.toUpperCase()}</span>
          <span className="text-border">/</span>
          <span>{agent.toUpperCase()}</span>
          <span className="text-border">·</span>
          <span>{d.triggerType.replace(/-/g, ' ')}</span>
          <span className="text-border">·</span>
          <span>{humanAge(d.createdAt)}</span>
        </div>
        <div className="mt-1 truncate text-sm text-text">{d.question}</div>
        {d.command && (
          <pre className="mt-1 overflow-hidden truncate rounded border border-border/40 bg-ink/60 px-2 py-1 font-mono text-[11px] text-muted">
            {d.command}
          </pre>
        )}
        {d.filePath && !d.command && (
          <div className="mt-1 truncate font-mono text-[11px] text-muted">{d.filePath}</div>
        )}
      </div>

      {/* Button bank */}
      <div className="flex items-center gap-1.5 px-2 py-2">
        <CommandButton
          tone="ok"
          isDefault={isDefault('approve')}
          onClick={(e) => {
            e.stopPropagation();
            approve.mutate(d.cockpitDecisionId);
          }}
          disabled={approve.isPending}
        >
          approve
        </CommandButton>
        <CommandButton
          tone="accent"
          isDefault={isDefault('reply')}
          active={replyOpen}
          onClick={(e) => {
            e.stopPropagation();
            const next = !replyOpen;
            setReplyOpen(next);
            // Opening reply needs context: select the session so the detail
            // panel slides in with the transcript + plan, and the camera
            // dollies to the agent's tile. You shouldn't reply blind.
            if (next) {
              setFocusedDecision(d.cockpitDecisionId);
              setSelected(d.cockpitSessionId);
            }
          }}
        >
          reply
        </CommandButton>
        <CommandButton
          tone="alarm"
          isDefault={isDefault('block')}
          onClick={(e) => {
            e.stopPropagation();
            block.mutate(d.cockpitDecisionId);
          }}
          disabled={block.isPending}
        >
          block
        </CommandButton>
      </div>

      {replyOpen && (
        <div
          className="col-span-3 border-t border-border/60 bg-ink/40 px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            autoFocus
            rows={3}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && replyText.trim()) {
                e.preventDefault();
                reply.mutate({ id: d.cockpitDecisionId, text: replyText.trim() });
              }
              if (e.key === 'Escape') {
                setReplyOpen(false);
                setReplyText('');
              }
            }}
            placeholder="reply to the agent — this becomes the deny reason it sees"
            className="w-full rounded border border-border bg-ink px-2 py-1 font-mono text-[11px] text-text"
          />
          <div className="mt-1.5 flex items-center justify-end gap-2 text-[10px] text-muted">
            <span className="font-mono">⌘↵ send · esc cancel</span>
            <button
              onClick={() => {
                setReplyOpen(false);
                setReplyText('');
              }}
              className="text-muted hover:text-text"
            >
              cancel
            </button>
            <button
              disabled={!replyText.trim() || reply.isPending}
              onClick={() => reply.mutate({ id: d.cockpitDecisionId, text: replyText.trim() })}
              className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-xs text-accent disabled:opacity-50"
            >
              {reply.isPending ? 'sending…' : 'send reply'}
            </button>
          </div>
          {reply.error && (
            <div className="mt-1 text-[10px] text-alarm">{(reply.error as Error).message}</div>
          )}
        </div>
      )}

      {/* Cooldown bar — full-width across the bottom */}
      {displayed !== null && (
        <div
          className={clsx(
            'absolute bottom-0 left-0 h-[2px] transition-[width] duration-300 ease-linear',
            SEVERITY_BAR[d.severity],
          )}
          style={{ width: `${(1 - displayed) * 100}%` }}
        />
      )}
    </div>
  );
}

function CommandButton({
  tone,
  isDefault,
  active,
  disabled,
  onClick,
  children,
}: {
  tone: 'ok' | 'alarm' | 'accent';
  isDefault?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  // Chunky cockpit-switch: thicker border, monospace caps, drop-shadow when
  // it's the default action so the eye reads the recommended path immediately.
  const palette = {
    ok: {
      base: 'border-ok/60 bg-ok/10 text-ok hover:bg-ok/25',
      filled: 'border-ok bg-ok/35 text-ok shadow-[0_0_8px_rgba(34,197,94,0.45)]',
    },
    alarm: {
      base: 'border-alarm/60 bg-alarm/10 text-alarm hover:bg-alarm/25',
      filled: 'border-alarm bg-alarm/35 text-alarm shadow-[0_0_8px_rgba(239,68,68,0.45)]',
    },
    accent: {
      base: 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/25',
      filled: 'border-accent bg-accent/35 text-accent shadow-[0_0_8px_rgba(125,211,252,0.45)]',
    },
  } as const;
  const p = palette[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors disabled:opacity-50',
        isDefault || active ? p.filled : p.base,
      )}
    >
      {children}
    </button>
  );
}

function humanAge(iso: string): string {
  const dt = Date.now() - Date.parse(iso);
  const m = Math.floor(dt / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function humanRemaining(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return '0s';
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  return `${Math.ceil(ms / 60_000)}m`;
}
