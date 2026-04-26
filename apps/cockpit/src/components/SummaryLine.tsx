import { useMemo } from 'react';
import clsx from 'clsx';
import type { DecisionRow, SessionRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';

// NASA-console / Airbus-glass-cockpit style instrument strip.
// Four readouts, evenly spaced, each with its own visual grammar:
//   1. DECISIONS gauge — circular arc fills amber→red as queue grows
//   2. FLEET bar     — segmented bar showing live agents (and blocked split)
//   3. BURN          — LCD-style $/h
//   4. EVENTS/MIN    — sparkline rolled from the live stream
// Plus a small ANNUNCIATOR strip at the very top that lights up amber/red
// when the most-urgent decision needs attention. Two-stage attention grab.

const DECISIONS_GAUGE_MAX = 12; // beyond which the gauge saturates

export function SummaryLine({
  decisions,
  sessions,
}: {
  decisions: DecisionRow[];
  sessions: SessionRow[];
}) {
  const recentEvents = useCockpitStore((s) => s.recentEventTimes);

  const open = decisions.filter((d) => d.status === 'open');
  const required = open.filter((d) => d.severity === 'required').length;
  const advisory = open.filter((d) => d.severity === 'advisory').length;
  const oldestMs = open.length ? Math.min(...open.map((d) => Date.parse(d.createdAt))) : null;

  const live = sessions.filter((s) => !['stopped', 'merged'].includes(s.state)).length;
  const blocked = sessions.filter(
    (s) => s.state === 'needs-decision' || s.state === 'blocked',
  ).length;
  const total = sessions.filter((s) => s.state !== 'merged').length;

  // Annunciator: name the worst thing right now, in the cockpit-callout style.
  const annunciator = useMemo(() => {
    const top =
      open
        .slice()
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .find((d) => d.severity === 'required') ?? open.find((d) => d.severity === 'advisory');
    if (!top) return null;
    const label = (() => {
      const session = sessions.find((s) => s.cockpitSessionId === top.cockpitSessionId);
      const project = session?.projectName ?? '';
      const agent = session?.agentLabel ?? top.cockpitSessionId.slice(-6);
      return `${project ? project + '/' : ''}${agent}`.toUpperCase();
    })();
    return { kind: top.severity, text: `${top.triggerType.replace(/-/g, ' ')} · ${label}` };
  }, [open, sessions]);

  return (
    <div className="shrink-0 select-none border-b border-border bg-panel">
      {/* Annunciator — only rendered when something demands attention */}
      {annunciator && (
        <div
          className={clsx(
            'flex items-center gap-2 border-b px-4 py-1 font-mono text-[11px] uppercase tracking-[0.2em]',
            annunciator.kind === 'required'
              ? 'border-alarm/60 bg-alarm/15 text-alarm animate-caution-pulse'
              : 'border-warn/50 bg-warn/10 text-warn',
          )}
        >
          <span aria-hidden className="text-base leading-none">
            ▲
          </span>
          <span>{annunciator.kind === 'required' ? 'DECISION REQUIRED' : 'ADVISORY'}</span>
          <span className="text-text/80">{annunciator.text}</span>
          {oldestMs && <span className="ml-auto text-text/60">oldest {humanAge(oldestMs)}</span>}
        </div>
      )}
      {/* Instrument strip */}
      <div className="grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-6 px-4 py-2">
        <DecisionGauge open={open.length} required={required} advisory={advisory} />
        <FleetBar live={live} blocked={blocked} total={total} />
        <BurnReadout sessions={sessions} />
        <EventsSparkline times={recentEvents} />
        <FleetState blocked={blocked} live={live} />
      </div>
    </div>
  );
}

function DecisionGauge({
  open,
  required,
  advisory,
}: {
  open: number;
  required: number;
  advisory: number;
}) {
  const t = Math.min(1, open / DECISIONS_GAUGE_MAX);
  // Arc spans 240° centred at 12 o'clock. Background = full arc dim, foreground = filled arc.
  const radius = 18;
  const cx = 22;
  const cy = 22;
  const startA = (-Math.PI * 2) / 3; // -120°
  const endA = (Math.PI * 2) / 3; // +120°
  const totalA = endA - startA;
  const fillEnd = startA + totalA * t;

  const stroke = required > 0 ? '#ef4444' : advisory > 0 ? '#f59e0b' : '#1a4a6a';

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-11 w-11">
        <svg viewBox="0 0 44 44" className="h-full w-full">
          <path
            d={arcPath(cx, cy, radius, startA, endA)}
            fill="none"
            stroke="#13202c"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {open > 0 && (
            <path
              d={arcPath(cx, cy, radius, startA, fillEnd)}
              fill="none"
              stroke={stroke}
              strokeWidth="3.5"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${stroke})` }}
            />
          )}
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fill={open > 0 ? '#cbd5df' : '#5a6573'}
            className="font-mono"
            fontSize="13"
            fontWeight="600"
          >
            {open}
          </text>
        </svg>
      </div>
      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted leading-tight">
        decisions
        <div className="text-[10px] text-text/80 normal-case tracking-normal">
          <span className={required ? 'text-alarm' : 'text-muted'}>{required} req</span>
          <span className="mx-1 text-border">·</span>
          <span className={advisory ? 'text-warn' : 'text-muted'}>{advisory} adv</span>
        </div>
      </div>
    </div>
  );
}

function FleetBar({ live, blocked, total }: { live: number; blocked: number; total: number }) {
  const segments = Math.max(total, 1);
  const blockedFraction = blocked / segments;
  const liveFraction = (live - blocked) / segments;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-11 w-28 flex-col justify-center">
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">fleet</div>
        <div className="mt-0.5 flex h-2 overflow-hidden rounded-sm border border-border bg-ink">
          <div
            className="h-full bg-alarm transition-[flex] duration-300"
            style={{ flex: blockedFraction }}
          />
          <div
            className="h-full bg-ok transition-[flex] duration-300"
            style={{ flex: liveFraction }}
          />
          <div className="h-full flex-1 bg-transparent" />
        </div>
        <div className="mt-1 font-mono text-[10px] text-text/80">
          <span className={blocked ? 'text-alarm' : 'text-text'}>{live - blocked}</span>
          <span className="text-border"> / </span>
          <span className="text-text">{total}</span>
          {blocked > 0 && (
            <>
              <span className="ml-2 text-alarm">▲ {blocked}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BurnReadout({ sessions }: { sessions: SessionRow[] }) {
  // Subscription-billed CLI agents — no $ out of pocket per turn. The CLI's
  // total_cost_usd is the equivalent API token-value of work done, useful
  // as a denominator for "how much have agents chewed through" but NOT a
  // dollar bill to the user. Labelled LOAD to avoid implying billing.
  const live = sessions.filter((s) => !['stopped', 'merged'].includes(s.state)).length;
  const total = sessions.filter((s) => s.state !== 'merged').length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-11 flex-col justify-center">
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">load</div>
        <div className="mt-0.5 font-mono text-[15px] tracking-tight text-accent tabular-nums">
          {live}
          <span className="ml-0.5 text-[9px] text-muted">/{total}</span>
        </div>
        <div className="text-[9px] font-mono text-muted">live · subscription</div>
      </div>
    </div>
  );
}

function EventsSparkline({ times }: { times: number[] }) {
  // Compute events-per-second over the last 60s in 12 buckets of 5s.
  const buckets = useMemo(() => {
    const now = Date.now();
    const out = new Array(12).fill(0);
    for (const t of times) {
      const ageS = (now - t) / 1000;
      if (ageS < 0 || ageS >= 60) continue;
      const idx = 11 - Math.floor(ageS / 5);
      out[idx]++;
    }
    return out;
  }, [times]);
  const max = Math.max(1, ...buckets);
  const w = 120;
  const h = 36;
  const stepX = w / buckets.length;
  const points = buckets
    .map((v, i) => {
      const x = i * stepX + stepX / 2;
      const y = h - 2 - (v / max) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // Recent count for label
  const eventsPerMin = times.length > 0 ? Math.round((times.length * 60) / 300) : 0;

  return (
    <div className="flex h-11 flex-col justify-center">
      <div className="flex items-baseline gap-2">
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted">events</div>
        <div className="font-mono text-[10px] text-text/80 tabular-nums">{eventsPerMin}/min</div>
      </div>
      <svg width={w} height={h} className="mt-0.5 overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke="#7dd3fc"
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 3px rgba(125, 211, 252, 0.7))' }}
        />
        {/* Baseline */}
        <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="#13202c" strokeWidth="1" />
      </svg>
    </div>
  );
}

function FleetState({ blocked, live }: { blocked: number; live: number }) {
  if (blocked > 0) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-alarm">
        FLEET BLOCKED
      </span>
    );
  }
  if (live === 0) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
        FLEET IDLE
      </span>
    );
  }
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ok">FLEET OK</span>
  );
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  // Note: SVG y-axis is flipped, so we invert sin to put 12 o'clock at the top.
  const x0 = cx + Math.sin(a0) * r;
  const y0 = cy - Math.cos(a0) * r;
  const x1 = cx + Math.sin(a1) * r;
  const y1 = cy - Math.cos(a1) * r;
  const largeArc = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function humanAge(ms: number): string {
  const dt = Date.now() - ms;
  const m = Math.floor(dt / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
