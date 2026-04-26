import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type DecisionRow, type EventRow, type SessionRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';
import { useCooldown } from '../lib/useCooldown';
import { PolicyMatrix } from './PolicyMatrix';

export function SessionDetail({ session }: { session: SessionRow }) {
  const qc = useQueryClient();
  const setSelected = useCockpitStore((s) => s.setSelected);
  const redirectingDecisionId = useCockpitStore((s) => s.redirectingDecisionId);
  const cancelRedirect = useCockpitStore((s) => s.cancelRedirect);
  const [reply, setReply] = useState('');
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  const eventsQ = useQuery({
    queryKey: ['session-events', session.cockpitSessionId],
    queryFn: () => api.listSessionEvents(session.cockpitSessionId, 200),
    refetchInterval: 5_000,
  });
  // Pull open decisions (queue cache) and surface any belonging to THIS
  // session as a context block at the top — the operator should never have
  // to scroll for "what is this agent waiting for me to decide".
  const decisionsQ = useQuery({
    queryKey: ['decisions', 'open'],
    queryFn: () => api.listDecisions('open'),
    refetchInterval: 5_000,
  });
  const openDecisions = useMemo(() => {
    const list = decisionsQ.data?.decisions ?? [];
    return list.filter((d) => d.cockpitSessionId === session.cockpitSessionId);
  }, [decisionsQ.data, session.cockpitSessionId]);

  // Redirect mode: only when the redirecting decision belongs to THIS
  // session (clicking redirect on a card from a different agent should
  // open that agent's panel, which then shows the band).
  const redirectingDecision = useMemo(() => {
    if (!redirectingDecisionId) return null;
    return openDecisions.find((d) => d.cockpitDecisionId === redirectingDecisionId) ?? null;
  }, [openDecisions, redirectingDecisionId]);
  const inRedirect = !!redirectingDecision;
  const redirectSeverity = redirectingDecision?.severity ?? null;

  // Focus the textarea when entering redirect mode so the operator
  // doesn't have to click again. Also clears any draft from a prior
  // normal-message session (different intent).
  useEffect(() => {
    if (inRedirect) {
      setReply('');
      replyRef.current?.focus();
    }
  }, [inRedirect]);

  // Listen for the keymap's 'l' command — focus our textarea when the
  // operator steps into the detail panel from the queue.
  useEffect(() => {
    function onFocusDetail() {
      replyRef.current?.focus();
    }
    window.addEventListener('cockpit:focus-detail', onFocusDetail);
    return () => window.removeEventListener('cockpit:focus-detail', onFocusDetail);
  }, []);

  const sendMsg = useMutation({
    mutationFn: (text: string) => api.sendSessionMessage(session.cockpitSessionId, text),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['session-events', session.cockpitSessionId] });
    },
  });
  const sendRedirect = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.reply(id, 'me', text),
    onSuccess: () => {
      setReply('');
      cancelRedirect();
      qc.invalidateQueries({ queryKey: ['decisions'] });
      qc.invalidateQueries({ queryKey: ['session-events', session.cockpitSessionId] });
    },
  });
  const stopMutation = useMutation({
    mutationFn: () => api.stopSession(session.cockpitSessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  // Esc to cancel redirect (if in redirect mode) or close panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (inRedirect) cancelRedirect();
      else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelected, inRedirect, cancelRedirect]);

  // Reverse to chronological for the timeline (API returns newest-first),
  // then collapse runs of consecutive text.delta from the same stream into
  // one paragraph. Streaming output otherwise produces dozens of tiny lines
  // that bury the structural events (tool.pre, plan.updated, cost.updated).
  const events = useMemo(() => {
    const list = eventsQ.data?.events ?? [];
    const chrono = [...list].reverse();
    const grouped: EventRow[] = [];
    for (const e of chrono) {
      const prev = grouped[grouped.length - 1];
      if (
        prev &&
        prev.type === 'text.delta' &&
        e.type === 'text.delta' &&
        prev.payload['stream'] === e.payload['stream']
      ) {
        prev.payload = {
          ...prev.payload,
          text: String(prev.payload['text'] ?? '') + String(e.payload['text'] ?? ''),
        };
        continue;
      }
      grouped.push({ ...e, payload: { ...e.payload } });
    }
    return grouped;
  }, [eventsQ.data]);

  // Auto-scroll to bottom when new events land, unless the user has scrolled up.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  // Last cost.updated event provides the running cost.
  const lastCost = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'cost.updated') return e.payload;
    }
    return null;
  }, [events]);

  const live = !session.endedAt;

  // Tab-trap: Tab/Shift+Tab inside the panel cycles its own focusable
  // elements rather than escaping to the queue cards. We re-query
  // each press so dynamically-mounted controls (redirect band ✕,
  // disabled send button) are picked up in the right order.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = panelRef.current;
    if (!root) return;
    const tabbable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null);
    if (tabbable.length === 0) return;
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={panelRef}
      onKeyDown={onPanelKeyDown}
      data-audit-id="session-detail"
      className="flex h-full flex-col overflow-hidden border-l border-border bg-panel/80"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-gradient-to-b from-accent/[0.04] to-transparent px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.4em] text-accent/80">
            ▸ agent
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="truncate font-display text-[18px] uppercase leading-none tracking-[0.12em] text-text">
              {session.agentLabel ?? session.cockpitSessionId.slice(-8)}
            </span>
            <span
              className={clsx(
                'rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.25em]',
                session.state === 'needs-decision' || session.state === 'blocked'
                  ? 'border-alarm/50 bg-alarm/10 text-alarm'
                  : session.state === 'implementing' || session.state === 'validating'
                    ? 'border-ok/50 bg-ok/10 text-ok'
                    : session.state === 'orienting' || session.state === 'ready-for-review'
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-border bg-ink/40 text-muted',
              )}
            >
              {session.state}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted">
            ID · {session.cockpitSessionId}
          </div>
          <div className="mt-1.5 line-clamp-2 text-xs text-muted">{session.task}</div>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          {live && (
            <button
              onClick={() => {
                if (confirm('Stop this agent? It will be killed and the worktree left in place.')) {
                  stopMutation.mutate();
                }
              }}
              disabled={stopMutation.isPending}
              className="rounded border border-alarm/60 bg-alarm/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-alarm hover:bg-alarm/25 disabled:opacity-50"
              title="Stop this agent"
            >
              {stopMutation.isPending ? 'stopping…' : '■ stop'}
            </button>
          )}
          <button
            onClick={() => setSelected(null)}
            className="text-muted hover:text-text"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Stat row */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border bg-ink/40 px-4 py-2 text-[10px] uppercase tracking-wide text-muted">
        <span>
          started{' '}
          <span className="text-text">{session.startedAt ? humanAge(session.startedAt) : '—'}</span>
        </span>
        <span>
          activity{' '}
          <span className="text-text">
            {session.lastEventAt ? humanAge(session.lastEventAt) : '—'}
          </span>
        </span>
        {lastCost && (
          <span title="Token-equivalent value of work done. Subscription users aren't billed per turn — this is a denominator for 'how much has this agent chewed through'.">
            tokens <span className="text-text">≈${formatCost(lastCost['totalCostUsd'])}</span>
          </span>
        )}
        {lastCost && (
          <span>
            turns <span className="text-text">{String(lastCost['numTurns'] ?? '?')}</span>
          </span>
        )}
      </div>

      {/* Autonomy policy — collapsed-by-default detail block. Read-only
          for now (step 1d of Group A); editable in step 4. */}
      <details className="shrink-0">
        <summary className="cursor-pointer border-b border-border bg-ink/30 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted hover:text-text">
          autonomy policy ▾
        </summary>
        <PolicyMatrix cockpitAgentId={session.cockpitAgentId} />
      </details>

      {/* Plan */}
      {session.currentTodos && session.currentTodos.length > 0 && (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">plan</div>
          <ul className="space-y-0.5 text-[11px]">
            {session.currentTodos.map((item, i) => (
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
                <span>
                  {item.status === 'in_progress' && item.activeForm
                    ? item.activeForm
                    : item.content}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Decision-context block — pinned above the timeline when this session
          has an open decision. Operator's whole reason for opening this panel
          is usually to act on a decision; show the relevant failure / path /
          question + buttons here without making them scroll. */}
      {openDecisions.length > 0 && (
        <div className="shrink-0 border-b border-accent/30 bg-ink/40">
          {openDecisions.map((d) => (
            <DecisionContextBlock key={d.cockpitDecisionId} decision={d} events={events} />
          ))}
        </div>
      )}

      {/* Timeline */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-y-auto px-4 py-2 text-[11px]"
      >
        {events.length === 0 ? (
          <div className="py-8 text-center text-muted">no events yet</div>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <EventRowItem key={e.cockpitEventId} event={e} />
            ))}
          </ul>
        )}
      </div>

      {/* Reply input — only when session is live. Switches into redirect
          mode when this session has the active redirect target: severity-
          tinted band, severity-bordered textarea, "▸ SEND REDIRECT"
          button. Submits to api.reply rather than sendSessionMessage. */}
      {live ? (
        <div className="shrink-0 border-t border-border bg-ink/40">
          {inRedirect && redirectingDecision && (
            <div
              className={clsx(
                'flex items-center gap-2 border-b px-3 py-1.5',
                redirectSeverity === 'required'
                  ? 'border-alarm/50 bg-alarm/10 text-alarm'
                  : 'border-warn/50 bg-warn/10 text-warn',
              )}
            >
              <span aria-hidden className="text-base leading-none">
                ▸
              </span>
              <span className="font-display text-[11px] uppercase tracking-[0.35em] drop-shadow-[0_0_4px_currentColor]">
                redirecting
              </span>
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-text/80">
                {redirectingDecision.question}
              </span>
              <button
                onClick={cancelRedirect}
                className="ml-auto rounded border border-current/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest hover:bg-current/10"
                title="Cancel redirect (Esc)"
              >
                ✕ cancel
              </button>
            </div>
          )}
          <div className="px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={replyRef}
                rows={2}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim()) {
                    e.preventDefault();
                    if (inRedirect && redirectingDecision) {
                      sendRedirect.mutate({
                        id: redirectingDecision.cockpitDecisionId,
                        text: reply.trim(),
                      });
                    } else {
                      sendMsg.mutate(reply.trim());
                    }
                  }
                }}
                placeholder={
                  inRedirect
                    ? 'redirect — sent to the agent as the reason · ⌘↵ to send · esc to cancel'
                    : 'message the agent — ⌘↵ to send'
                }
                className={clsx(
                  'flex-1 resize-none rounded border bg-ink px-2 py-1 font-mono text-[11px] text-text focus:outline-none',
                  inRedirect && redirectSeverity === 'required'
                    ? 'border-alarm/60 focus:border-alarm'
                    : inRedirect && redirectSeverity === 'advisory'
                      ? 'border-warn/60 focus:border-warn'
                      : 'border-border focus:border-accent/60',
                )}
              />
              <button
                disabled={
                  !reply.trim() ||
                  (inRedirect ? sendRedirect.isPending : sendMsg.isPending)
                }
                onClick={() => {
                  if (inRedirect && redirectingDecision) {
                    sendRedirect.mutate({
                      id: redirectingDecision.cockpitDecisionId,
                      text: reply.trim(),
                    });
                  } else {
                    sendMsg.mutate(reply.trim());
                  }
                }}
                className={clsx(
                  'rounded border-2 px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.25em] transition-colors disabled:opacity-50',
                  inRedirect && redirectSeverity === 'required'
                    ? 'border-alarm bg-alarm/15 text-alarm hover:bg-alarm/30 shadow-[0_0_10px_rgba(239,68,68,0.45)]'
                    : inRedirect && redirectSeverity === 'advisory'
                      ? 'border-warn bg-warn/15 text-warn hover:bg-warn/30 shadow-[0_0_10px_rgba(245,158,11,0.45)]'
                      : 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/25',
                )}
              >
                {inRedirect
                  ? sendRedirect.isPending
                    ? 'sending…'
                    : '▸ send redirect'
                  : sendMsg.isPending
                    ? 'sending…'
                    : 'send'}
              </button>
            </div>
            {(sendMsg.error || sendRedirect.error) && (
              <div className="mt-1 font-mono text-[10px] text-alarm">
                {((sendMsg.error || sendRedirect.error) as Error).message}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border bg-ink/40 px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
          session ended
        </div>
      )}
    </div>
  );
}

function EventRowItem({ event: e }: { event: EventRow }) {
  const time = humanTime(e.timestamp);
  switch (e.type) {
    case 'session.started':
      return (
        <li className="text-muted">
          <span className="mr-2 text-[10px]">{time}</span>
          <span className="text-ok">▶ session started</span>
        </li>
      );
    case 'session.ended':
      return (
        <li className="text-muted">
          <span className="mr-2 text-[10px]">{time}</span>
          <span className="text-muted">■ session ended</span>
        </li>
      );
    case 'text.delta': {
      const text = (e.payload['text'] as string | undefined) ?? '';
      const stream = e.payload['stream'] as string | undefined;
      const isError = stream === 'stderr';
      const isUser = stream === 'user';
      if (isUser) {
        return (
          <li className="flex justify-end">
            <div className="max-w-[85%] rounded border border-accent/40 bg-accent/[0.08] px-2 py-1 text-text">
              <div className="mb-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-accent/80">
                <span>▸ you</span>
                <span className="text-muted">{time}</span>
              </div>
              <div className="whitespace-pre-wrap">{text.trim()}</div>
            </div>
          </li>
        );
      }
      return (
        <li className={clsx(isError ? 'text-alarm/80' : 'text-text')}>
          <span className="mr-2 text-[10px] text-muted">{time}</span>
          <span className="whitespace-pre-wrap">{text.trim()}</span>
        </li>
      );
    }
    case 'tool.pre': {
      const tool = e.payload['toolName'] as string | undefined;
      const cmd = e.payload['command'] as string | undefined;
      const file = e.payload['filePath'] as string | undefined;
      return (
        <li className="text-accent">
          <span className="mr-2 text-[10px] text-muted">{time}</span>
          <span className="text-accent">→ {tool}</span>
          {(cmd || file) && (
            <span className="ml-2 truncate font-mono text-[10px] text-muted">{cmd ?? file}</span>
          )}
        </li>
      );
    }
    case 'tool.post': {
      const isError = e.payload['isError'] === true;
      const exit = e.payload['exitCode'];
      return (
        <li className={isError ? 'text-alarm/80' : 'text-muted'}>
          <span className="mr-2 text-[10px] text-muted">{time}</span>
          <span>{isError ? '✗ tool failed' : '✓ tool ok'}</span>
          {exit !== undefined && exit !== null && (
            <span className="ml-2 text-[10px]">exit={String(exit)}</span>
          )}
        </li>
      );
    }
    case 'plan.updated': {
      const items = e.payload['items'] as { content: string }[] | undefined;
      return (
        <li className="text-muted">
          <span className="mr-2 text-[10px]">{time}</span>
          <span>plan updated ({items?.length ?? 0} items)</span>
        </li>
      );
    }
    case 'cost.updated': {
      const cost = e.payload['totalCostUsd'];
      return (
        <li className="text-muted">
          <span className="mr-2 text-[10px]">{time}</span>
          <span>turn complete · ≈${formatCost(cost)} tokens</span>
        </li>
      );
    }
    case 'notification': {
      const msg = e.payload['message'] as string | undefined;
      return (
        <li className="text-warn">
          <span className="mr-2 text-[10px] text-muted">{time}</span>
          <span>⚑ {msg}</span>
        </li>
      );
    }
    case 'error': {
      const msg = e.payload['message'] as string | undefined;
      return (
        <li className="text-alarm">
          <span className="mr-2 text-[10px] text-muted">{time}</span>
          <span>error: {msg}</span>
        </li>
      );
    }
    default:
      return (
        <li className="text-muted">
          <span className="mr-2 text-[10px]">{time}</span>
          <span>{e.type}</span>
        </li>
      );
  }
}

function humanAge(iso: string): string {
  const dt = Date.now() - Date.parse(iso);
  const s = Math.floor(dt / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DC_SEVERITY_FG: Record<DecisionRow['severity'], string> = {
  required: 'text-alarm',
  advisory: 'text-warn',
  info: 'text-accent',
};
const DC_SEVERITY_BG: Record<DecisionRow['severity'], string> = {
  required: 'border-alarm/60 bg-alarm/[0.07]',
  advisory: 'border-warn/60 bg-warn/[0.05]',
  info: 'border-border bg-panel',
};
const DC_GLYPH: Record<DecisionRow['severity'], string> = {
  required: '▲',
  advisory: '◐',
  info: '•',
};

// Decision-context block: rendered above the timeline when this session has
// an open decision. Surfaces the question + relevant evidence (command, recent
// stderr, filePath, notification message) without making the operator scroll.
// Includes inline approve/reply/block so a decision found via the timeline can
// be acted on immediately.
function DecisionContextBlock({
  decision: d,
  events,
}: {
  decision: DecisionRow;
  events: EventRow[];
}) {
  const qc = useQueryClient();
  const cooldown = useCooldown(d.createdAt, d.expiresAt);

  // Find the most recent tool.post for this decision's tool — its stderr/stdout
  // is usually the actual evidence the operator needs to read. For Bash this
  // is the test output; for Edit this is the diff result; etc.
  const evidence = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== 'tool.post') continue;
      const raw = (e.payload['raw'] as Record<string, unknown> | undefined) ?? {};
      const tr = (raw['tool_response'] as Record<string, unknown> | undefined) ?? {};
      const stderr = typeof tr['stderr'] === 'string' ? (tr['stderr'] as string) : '';
      const stdout = typeof tr['stdout'] === 'string' ? (tr['stdout'] as string) : '';
      const error = typeof raw['error'] === 'string' ? (raw['error'] as string) : '';
      if (stderr || stdout || error) {
        return { stderr, stdout, error };
      }
    }
    return null;
  }, [events]);

  const approve = useMutation({
    mutationFn: () => api.approve(d.cockpitDecisionId, 'me'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions'] }),
  });
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const reply = useMutation({
    mutationFn: (text: string) => api.reply(d.cockpitDecisionId, 'me', text),
    onSuccess: () => {
      setReplyOpen(false);
      setReplyText('');
      qc.invalidateQueries({ queryKey: ['decisions'] });
    },
  });

  return (
    <div
      className={clsx('relative border-b border-border/40 px-4 py-2.5', DC_SEVERITY_BG[d.severity])}
    >
      <div className="flex items-start gap-3">
        <div className={clsx('flex flex-col items-center pt-0.5', DC_SEVERITY_FG[d.severity])}>
          <span className="text-xl leading-none">{DC_GLYPH[d.severity]}</span>
          <span className="font-mono text-[9px] tracking-[0.2em]">
            {d.severity === 'required' ? 'REQ' : d.severity === 'advisory' ? 'ADV' : 'INFO'}
          </span>
          {d.expiresAt && cooldown !== null && cooldown < 1 && (
            <span className="mt-0.5 font-mono text-[9px] text-muted">
              {Math.max(0, Math.ceil((Date.parse(d.expiresAt) - Date.now()) / 1000))}s
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {d.triggerType.replace(/-/g, ' ')}
          </div>
          <div className="mt-0.5 text-sm font-medium text-text">{d.question}</div>
          {d.command && (
            <pre className="mt-1.5 overflow-x-auto rounded border border-border/50 bg-ink/70 px-2 py-1 font-mono text-[11px] text-text">
              {d.command}
            </pre>
          )}
          {d.filePath && !d.command && (
            <div className="mt-1.5 truncate font-mono text-[11px] text-text">{d.filePath}</div>
          )}
          {evidence && (evidence.stderr || evidence.error) && (
            <div className="mt-1.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
                stderr
              </div>
              <pre className="mt-0.5 max-h-24 overflow-auto rounded border border-alarm/40 bg-alarm/5 px-2 py-1 font-mono text-[10px] text-alarm/90">
                {(evidence.stderr || evidence.error).slice(0, 800)}
              </pre>
            </div>
          )}
          {evidence && evidence.stdout && !evidence.stderr && !evidence.error && (
            <div className="mt-1.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
                output
              </div>
              <pre className="mt-0.5 max-h-24 overflow-auto rounded border border-border bg-ink/40 px-2 py-1 font-mono text-[10px] text-text">
                {evidence.stdout.slice(0, 600)}
              </pre>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1">
          <button
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className={clsx(
              'rounded border-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors disabled:opacity-50',
              d.defaultChoice === 'approve'
                ? 'border-ok bg-ok/35 text-ok shadow-[0_0_8px_rgba(34,197,94,0.45)]'
                : 'border-ok/60 bg-ok/10 text-ok hover:bg-ok/25',
            )}
          >
            approve
          </button>
          <button
            onClick={() => setReplyOpen((v) => !v)}
            className={clsx(
              'rounded border-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors',
              replyOpen || d.defaultChoice === 'reply' || d.defaultChoice === 'block'
                ? 'border-accent bg-accent/35 text-accent shadow-[0_0_8px_rgba(125,211,252,0.45)]'
                : 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/25',
            )}
          >
            redirect
          </button>
        </div>
      </div>
      {replyOpen && (
        <div className="mt-2 space-y-1.5">
          <textarea
            autoFocus
            rows={3}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && replyText.trim()) {
                e.preventDefault();
                reply.mutate(replyText.trim());
              }
              if (e.key === 'Escape') {
                setReplyOpen(false);
                setReplyText('');
              }
            }}
            placeholder="redirect — sent to the agent as the reason"
            className="w-full rounded border border-border bg-ink px-2 py-1 font-mono text-[11px] text-text"
          />
          <div className="flex items-center justify-end gap-2 text-[10px] text-muted">
            <span className="font-mono">⌘↵ send · esc cancel</span>
            <button
              disabled={!replyText.trim() || reply.isPending}
              onClick={() => reply.mutate(replyText.trim())}
              className="rounded border border-accent/60 bg-accent/10 px-2 py-1 text-xs text-accent disabled:opacity-50"
            >
              {reply.isPending ? 'sending…' : 'send redirect'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function humanTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCost(cost: unknown): string {
  if (typeof cost !== 'number') return '?';
  return cost.toFixed(4);
}
