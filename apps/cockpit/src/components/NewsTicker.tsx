// News ticker — bottom-of-screen 30px glass strip showing important
// agent events as they happen. NASA mission-control / stock-ticker
// vibe. Items scroll right→left at constant velocity.
//
// Data flow:
//   - On mount: GET /ticker for backfill (last 60 from Redis).
//   - Live: useLiveStream classifies the firehose with the same
//     predicate the server uses and dispatches `cockpit:ticker-item`
//     CustomEvents we listen to here.
//
// Scroll mechanics: two copies of the items are rendered back-to-back
// in a single flex row that translates by -50% over a duration scaled
// to total content width. CSS-only loop, no JS animation tick.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, type TickerItem } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';

const MAX_ITEMS = 80;
// Pixels per second — gentle, easy to read. Increase to speed up.
const SCROLL_SPEED_PX_S = 60;

export function NewsTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const setSelected = useCockpitStore((s) => s.setSelected);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Backfill on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .listTicker(60)
      .then((res) => {
        if (cancelled) return;
        // Server returns newest-first; the visual model is left-to-right
        // chronological with the freshest entering on the right. So we
        // render newest LAST so it sits at the right edge of the strip.
        setItems(res.items.slice().reverse());
      })
      .catch(() => {
        /* ignore — empty initial state is fine */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live additions.
  useEffect(() => {
    function onItem(e: Event) {
      const item = (e as CustomEvent<TickerItem>).detail;
      if (!item) return;
      setItems((prev) => {
        const next = [...prev, item];
        if (next.length > MAX_ITEMS) next.splice(0, next.length - MAX_ITEMS);
        return next;
      });
    }
    window.addEventListener('cockpit:ticker-item', onItem);
    return () => window.removeEventListener('cockpit:ticker-item', onItem);
  }, []);

  // Measure rendered single-loop width so we can derive a constant
  // px/s scroll duration. We measure the FIRST half of the doubled
  // track (its scrollWidth ÷ 2 would also work, but reading children
  // directly is clearer).
  const updateWidth = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return;
    setTrackWidthPx(first.scrollWidth);
  }, []);
  useEffect(() => {
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [items, updateWidth]);

  const onClickItem = useCallback(
    (item: TickerItem) => {
      if (item.cockpitSessionId) setSelected(item.cockpitSessionId);
    },
    [setSelected],
  );

  // Stable id derivation for keys — combine timestamp and a short hash
  // of the message so duplicates within the same ms still get unique
  // keys (rare, but possible for plan.updated).
  const keyed = useMemo(
    () => items.map((it, idx) => ({ key: `${it.ts}-${idx}`, item: it })),
    [items],
  );

  if (items.length === 0) return null;

  const durationS = trackWidthPx > 0 ? trackWidthPx / SCROLL_SPEED_PX_S : 30;

  return (
    <div
      data-audit-id="news-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 h-[30px] overflow-hidden border-t border-border/60 bg-panel/70 backdrop-blur-md"
    >
      {/* Eyebrow tag at the left — sticky over the scroll. */}
      <div className="absolute left-0 top-0 z-10 flex h-full items-center gap-1 border-r border-border/60 bg-panel/85 px-3 font-display text-[10px] uppercase tracking-[0.32em] text-muted backdrop-blur-md">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_4px_rgba(125,211,252,0.7)] animate-rec-pulse" />
        feed
      </div>
      {/* Doubled track for seamless loop. The whole row translates by
          -50% — at the loop point the second copy is exactly where the
          first started, so no jump. */}
      <div
        ref={trackRef}
        className="flex h-full whitespace-nowrap pl-[88px] will-change-transform"
        style={{
          animation: `ticker-scroll ${durationS.toFixed(2)}s linear infinite`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      >
        <Row keyed={keyed} onClickItem={onClickItem} />
        <Row keyed={keyed} onClickItem={onClickItem} aria-hidden />
      </div>
      {/* Right-edge fade so items don't punch the viewport edge. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-panel/70 to-transparent" />
      <style>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function Row({
  keyed,
  onClickItem,
  ...rest
}: {
  keyed: { key: string; item: TickerItem }[];
  onClickItem: (item: TickerItem) => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex h-full items-center" {...rest}>
      {keyed.map(({ key, item }) => (
        <TickerEntry key={key} item={item} onClick={() => onClickItem(item)} />
      ))}
    </div>
  );
}

const KIND_GLYPH: Record<TickerItem['kind'], string> = {
  error: '▲',
  notification: '⚑',
  decision: '◆',
  session: '▶',
  plan: '→',
};

const KIND_COLOR: Record<TickerItem['kind'], string> = {
  error: 'text-alarm',
  notification: 'text-warn',
  decision: 'text-accent',
  session: 'text-muted',
  plan: 'text-text/80',
};

function TickerEntry({ item, onClick }: { item: TickerItem; onClick: () => void }) {
  const sevColour =
    item.severity === 'required'
      ? 'text-alarm'
      : item.severity === 'advisory'
        ? 'text-warn'
        : KIND_COLOR[item.kind];
  return (
    <button
      onClick={onClick}
      className="group flex h-full items-center gap-2 px-4 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-accent/5"
      title={item.message}
    >
      <span className={clsx('shrink-0 text-[10px] leading-none', sevColour)}>
        {KIND_GLYPH[item.kind]}
      </span>
      <span className="text-muted">{shortTime(item.ts)}</span>
      <span className={clsx('truncate', sevColour)}>{item.message}</span>
      <span className="text-border">·</span>
    </button>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
