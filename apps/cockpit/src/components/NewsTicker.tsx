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
// Scroll mechanics: Framer Motion's parallax-ticker pattern. A
// motion value advances each frame at constant px/s, wrapped into
// the range [-contentWidth, 0]. We render enough duplicate copies
// of the row to always overflow the viewport, so the wrap point is
// invisible regardless of how many items there are.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useAnimationFrame, useMotionValue, useTransform, wrap } from 'motion/react';
import clsx from 'clsx';
import { api, type TickerItem } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';

const MAX_ITEMS = 80;
// Pixels per second — gentle, easy to read. Increase to speed up.
const SCROLL_SPEED_PX_S = 60;

export function NewsTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);
  const setSelected = useCockpitStore((s) => s.setSelected);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rowWidthPx, setRowWidthPx] = useState(0);
  const [containerWidthPx, setContainerWidthPx] = useState(0);
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

  // Measure single-row width and container width. We need both so we
  // can decide how many copies of the row to render — enough to always
  // overflow the container, so the wrap is invisible.
  const measure = useCallback(() => {
    if (rowRef.current) setRowWidthPx(rowRef.current.scrollWidth);
    if (containerRef.current) setContainerWidthPx(containerRef.current.clientWidth);
  }, []);
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (rowRef.current) ro.observe(rowRef.current);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [items, measure]);

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

  // Number of row copies — at least 2 (so wrap has something to reveal),
  // and enough that copies × rowWidth > container + rowWidth (so there
  // is always content past both edges).
  const copies = useMemo(() => {
    if (rowWidthPx <= 0) return 2;
    const needed = Math.ceil((containerWidthPx + rowWidthPx) / rowWidthPx) + 1;
    return Math.max(2, needed);
  }, [rowWidthPx, containerWidthPx]);

  // The motion value drives translateX. Each frame we advance it by
  // (speed × dt) and wrap into [-rowWidth, 0]. Wrapping at -rowWidth
  // (one full row) means the second copy slides into the first copy's
  // exact position — seamless loop, regardless of how many copies we
  // render.
  const baseX = useMotionValue(0);
  const x = useTransform(baseX, (v) => `${rowWidthPx > 0 ? wrap(-rowWidthPx, 0, v) : 0}px`);

  useAnimationFrame((_t, delta) => {
    if (paused || rowWidthPx <= 0) return;
    // delta is ms; convert to seconds and advance left (negative).
    baseX.set(baseX.get() - (SCROLL_SPEED_PX_S * delta) / 1000);
  });

  if (items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      data-audit-id="news-ticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 h-[30px] w-full overflow-hidden border-t border-border/60 bg-panel/70 backdrop-blur-md"
    >
      {/* Eyebrow tag at the left — sticky over the scroll. */}
      <div className="absolute left-0 top-0 z-10 flex h-full items-center gap-1 border-r border-border/60 bg-panel/85 px-3 font-display text-[10px] uppercase tracking-[0.32em] text-muted backdrop-blur-md">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_4px_rgba(125,211,252,0.7)] animate-rec-pulse" />
        feed
      </div>
      {/* Translating track. We render `copies` repeats of the same row
          end-to-end; the motion value wraps every rowWidth so the loop
          is invisible. */}
      <motion.div
        className="flex h-full whitespace-nowrap pl-[88px] will-change-transform"
        style={{ x }}
      >
        {/* First copy is the measured one — its width sets the wrap
            distance. Remaining copies are aria-hidden duplicates. */}
        <Row ref={rowRef} keyed={keyed} onClickItem={onClickItem} />
        {Array.from({ length: copies - 1 }).map((_, i) => (
          <Row key={`dup-${i}`} keyed={keyed} onClickItem={onClickItem} aria-hidden />
        ))}
      </motion.div>
      {/* Right-edge fade so items don't punch the viewport edge. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-panel/70 to-transparent" />
    </div>
  );
}

const Row = ({
  ref,
  keyed,
  onClickItem,
  ...rest
}: {
  ref?: React.Ref<HTMLDivElement>;
  keyed: { key: string; item: TickerItem }[];
  onClickItem: (item: TickerItem) => void;
} & React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div ref={ref} className="flex h-full shrink-0 items-center" {...rest}>
      {keyed.map(({ key, item }) => (
        <TickerEntry key={key} item={item} onClick={() => onClickItem(item)} />
      ))}
    </div>
  );
};

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
