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

// Kept as a no-op export so call sites that still import it don't break
// during the cleanup pass. The annunciator now lives inside <MapHUD/>
// as a slide-down tail.
export function SummaryLine(_props: { decisions: DecisionRow[]; sessions: SessionRow[] }) {
  return null;
}

// MapHUD: floating glass panel of fleet instruments. Lives as an
// absolute-positioned overlay at the top of the canvas (matches
// swarm-assembler's GraphToolbar pattern).
//
// When something demands attention, the HUD grows a slide-down tail
// rather than a separate top-of-app banner. The tail is the only place
// the annunciator lives — peripheral attention grab stays where the
// operator's eye already is.
export function MapHUD({
  decisions,
  sessions,
}: {
  decisions: DecisionRow[];
  sessions: SessionRow[];
}) {
  const recentEvents = useCockpitStore((s) => s.recentEventTimes);
  const setKeymapOpen = useCockpitStore((s) => s.setKeymapOpen);
  const setSelected = useCockpitStore((s) => s.setSelected);

  const open = decisions.filter((d) => d.status === 'open');
  const required = open.filter((d) => d.severity === 'required').length;
  const advisory = open.filter((d) => d.severity === 'advisory').length;

  const live = sessions.filter((s) => !['stopped', 'merged'].includes(s.state)).length;
  const blocked = sessions.filter(
    (s) => s.state === 'needs-decision' || s.state === 'blocked',
  ).length;
  const total = sessions.filter((s) => s.state !== 'merged').length;

  // Worst-open decision drives the slide-down annunciator. Required
  // before advisory; oldest first within a severity.
  const worst = useMemo(() => {
    const byAge = open.slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return byAge.find((d) => d.severity === 'required') ?? byAge.find((d) => d.severity === 'advisory') ?? null;
  }, [open]);
  const annunciatorKind: 'required' | 'advisory' | null = worst?.severity === 'required'
    ? 'required'
    : worst?.severity === 'advisory'
      ? 'advisory'
      : null;

  return (
    <div
      data-audit-id="map-hud"
      className="pointer-events-auto flex select-none flex-col overflow-hidden rounded-xl border border-border/60 bg-panel/70 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-md"
    >
      {/* Instrument row — always visible. */}
      <div className="flex items-center gap-8 whitespace-nowrap px-5 py-2">
        <DecisionGauge open={open.length} required={required} advisory={advisory} />
        <FleetBar live={live} blocked={blocked} total={total} />
        <BurnReadout sessions={sessions} />
        <EventsSparkline times={recentEvents} />
        <FleetState blocked={blocked} live={live} />
        <button
          onClick={() => setKeymapOpen(true)}
          className="rounded border border-border bg-panel/80 px-2 py-1 text-[10px] text-muted hover:text-text"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
      </div>

      {/* Annunciator tail — slides out below the instruments when
          something demands attention. Pure CSS height/opacity transition
          on the inner band; the outer container is overflow-hidden so
          the panel itself appears to grow downward. */}
      <div
        data-audit-id="annunciator"
        aria-hidden={annunciatorKind === null}
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
          annunciatorKind ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <button
            type="button"
            onClick={() => worst && setSelected(worst.cockpitSessionId)}
            className={clsx(
              'flex w-full items-center justify-center gap-3 border-t px-4 py-1.5 text-left transition-colors',
              annunciatorKind === 'required'
                ? 'border-alarm/60 bg-alarm/15 text-alarm hover:bg-alarm/25 animate-caution-pulse'
                : 'border-warn/50 bg-warn/10 text-warn hover:bg-warn/20',
            )}
          >
            <span aria-hidden className="text-base leading-none">
              ▲
            </span>
            <span className="font-display text-[12px] uppercase tracking-[0.4em] drop-shadow-[0_0_6px_currentColor]">
              {annunciatorKind === 'required' ? 'decision required' : 'advisory'}
            </span>
          </button>
        </div>
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
      <div className="font-display text-[10px] uppercase tracking-[0.3em] text-muted leading-tight">
        decisions
        <div className="mt-0.5 font-mono text-[10px] text-text/80 normal-case tracking-normal">
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
        <div className="font-display text-[10px] uppercase tracking-[0.3em] text-muted">fleet</div>
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
        <div className="font-display text-[10px] uppercase tracking-[0.3em] text-muted">load</div>
        <div className="mt-0.5 font-display text-[18px] leading-none tracking-[0.05em] text-accent tabular-nums">
          {live}
          <span className="ml-0.5 font-mono text-[9px] text-muted">/{total}</span>
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">live · sub</div>
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
        <div className="font-display text-[10px] uppercase tracking-[0.3em] text-muted">events</div>
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
  const base = 'font-display text-[12px] uppercase tracking-[0.35em]';
  if (blocked > 0) {
    return (
      <span className={clsx(base, 'text-alarm drop-shadow-[0_0_6px_rgba(239,68,68,0.5)]')}>
        fleet blocked
      </span>
    );
  }
  if (live === 0) {
    return <span className={clsx(base, 'text-muted')}>fleet idle</span>;
  }
  return (
    <span className={clsx(base, 'text-ok drop-shadow-[0_0_6px_rgba(34,197,94,0.45)]')}>
      fleet ok
    </span>
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

