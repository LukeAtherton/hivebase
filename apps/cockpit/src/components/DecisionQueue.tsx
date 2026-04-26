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
  // Floating mode: when there's nothing to act on, render nothing —
  // the canvas stays clear and the camera centres. Otherwise show the
  // bare stack of cards. No header, no panel chrome — the cards are
  // the chrome.
  if (decisions.length === 0) return null;
  return (
    <div
      data-audit-id="decision-queue"
      className="flex h-full flex-col gap-2 overflow-y-auto pr-1"
    >
      {decisions.map((d) => (
        <DecisionCard key={d.cockpitDecisionId} decision={d} sessions={sessions} />
      ))}
    </div>
  );
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
  const startRedirect = useCockpitStore((s) => s.startRedirect);
  const focused = useCockpitStore((s) => s.focusedDecisionId === d.cockpitDecisionId);
  const isRedirecting = useCockpitStore((s) => s.redirectingDecisionId === d.cockpitDecisionId);
  const [hovered, setHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (focused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // Auto-select the focused decision's session — pulls the detail panel
      // open with the agent's transcript + plan + cost. Operator can't make
      // an informed call without context (Stellaris alert→system pattern).
      setSelected(d.cockpitSessionId);
    }
  }, [focused, d.cockpitSessionId, setSelected]);

  const approve = useMutation({
    mutationFn: (id: string) => api.approve(id, 'me'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions'] }),
  });

  const cooldown = useCooldown(d.createdAt, d.expiresAt);
  const engaged = hovered || isRedirecting;
  const displayed = engaged && cooldown !== null && cooldown < 1 ? null : cooldown;

  const isDefault = (action: 'approve' | 'block' | 'reply') => d.defaultChoice === action;
  const session = sessions.find((s) => s.cockpitSessionId === d.cockpitSessionId);
  const project = session?.projectName ?? d.cockpitSessionId.slice(-6);
  const agent = session?.agentLabel ?? d.cockpitSessionId.slice(-6);

  // Severity left-edge stripe colour.
  const stripe =
    d.severity === 'required'
      ? 'border-l-alarm'
      : d.severity === 'advisory'
        ? 'border-l-warn'
        : 'border-l-accent';

  return (
    <div
      ref={cardRef}
      className={clsx(
        // Floating glass card with a 3px severity left-edge stripe.
        // No internal severity rail — the stripe + the eyebrow glyph
        // carry the signal.
        'group relative flex rounded-md border border-border/60 border-l-[3px] bg-panel/85 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.45)] transition-[outline,transform]',
        stripe,
        focused && 'outline outline-2 outline-offset-[-2px] outline-accent',
        isRedirecting && 'outline outline-2 outline-offset-[-2px] outline-current',
      )}
      onClick={() => {
        setFocusedDecision(d.cockpitDecisionId);
        setSelected(d.cockpitSessionId);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Body column — eyebrow + content; no inline action bank. */}
      <div className="min-w-0 flex-1 flex flex-col gap-1.5 px-3 py-2.5">
        {/* Eyebrow: severity glyph + project/agent + age. Single row. */}
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
          <span className={clsx('inline-flex items-center gap-1', SEVERITY_FG[d.severity])}>
            <span aria-hidden className="text-[11px] leading-none">
              {SEVERITY_GLYPH[d.severity]}
            </span>
            <span>{SEVERITY_LABEL[d.severity]}</span>
          </span>
          <span className="text-border">·</span>
          <span className="truncate text-text/80">
            {project.toUpperCase()}
            <span className="text-border">/</span>
            {agent.toUpperCase()}
          </span>
          <span className="ml-auto shrink-0 text-muted">{humanAge(d.createdAt)}</span>
          {d.expiresAt && cooldown !== null && cooldown < 1 && (
            <span className="shrink-0 text-muted">⏱ {humanRemaining(d.expiresAt)}</span>
          )}
        </div>

        {/* Question — the headline. */}
        <div className="text-[13px] leading-snug text-text">{d.question}</div>

        {/* Detail / intent — one rank below the question. */}
        {d.detail && (
          <div className="line-clamp-2 text-[11px] leading-snug text-text/65">{d.detail}</div>
        )}

        {/* Command or filePath preview. */}
        {d.command && (
          <pre className="overflow-hidden truncate rounded-sm border border-border/40 bg-ink/60 px-2 py-1 font-mono text-[11px] text-muted">
            {d.command}
          </pre>
        )}
        {d.filePath && !d.command && (
          <div className="truncate font-mono text-[11px] text-muted">{d.filePath}</div>
        )}

        {/* Evidence — first line full, rest collapsed to a count. */}
        {d.evidenceLines && d.evidenceLines.length > 0 && (
          <div className="rounded-sm border border-border/40 bg-ink/40 px-2 py-1">
            <ul className="space-y-0.5 font-mono text-[11px] leading-tight text-text/80">
              {d.evidenceLines.slice(0, 2).map((line, i) => (
                <li key={i} className="truncate" title={line}>
                  {line}
                </li>
              ))}
            </ul>
            {d.evidenceLines.length > 2 && (
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.25em] text-muted">
                + {d.evidenceLines.length - 2} more
              </div>
            )}
          </div>
        )}

        {approve.error && (
          <div className="font-mono text-[10px] text-alarm">
            ▲ {(approve.error as Error).message}
          </div>
        )}
      </div>

      {/* Right-edge action tabs — APPROVE on top half, REDIRECT on bottom
          half, each fills 50% of the card height. The tab surface
          inherits the card background (no tinted fill); only the icon
          carries the action's colour. A subtle inner glow on the
          default-action tab marks the recommended path without making
          the surface itself loud. Native title tooltip surfaces the
          label on hover. */}
      <div className="flex w-[56px] shrink-0 flex-col border-l border-border/50">
        <button
          title={isDefault('approve') ? 'Approve (recommended)' : 'Approve'}
          aria-label="Approve"
          onClick={(e) => {
            e.stopPropagation();
            approve.mutate(d.cockpitDecisionId);
          }}
          disabled={approve.isPending}
          className={clsx(
            'flex flex-1 items-center justify-center border-b border-border/50 text-[20px] leading-none text-ok transition-colors hover:bg-ok/10 disabled:opacity-50',
            isDefault('approve') && 'shadow-[inset_0_0_18px_rgba(34,197,94,0.18)]',
          )}
        >
          {approve.isPending ? '…' : '✓'}
        </button>
        <button
          title={
            isRedirecting
              ? 'Redirect (active — focus textarea)'
              : isDefault('reply') || isDefault('block')
                ? 'Redirect (recommended)'
                : 'Redirect'
          }
          aria-label="Redirect"
          onClick={(e) => {
            e.stopPropagation();
            startRedirect(d.cockpitDecisionId, d.cockpitSessionId);
          }}
          className={clsx(
            'flex flex-1 items-center justify-center text-[18px] leading-none text-accent transition-colors hover:bg-accent/10',
            isRedirecting && 'bg-accent/15 shadow-[inset_0_0_18px_rgba(125,211,252,0.35)]',
            !isRedirecting &&
              (isDefault('reply') || isDefault('block')) &&
              'shadow-[inset_0_0_18px_rgba(125,211,252,0.18)]',
          )}
        >
          ↪
        </button>
      </div>

      {/* Cooldown bar — full-width across the bottom. */}
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
