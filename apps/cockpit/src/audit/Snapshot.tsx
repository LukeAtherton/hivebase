// Renders a captured cockpit snapshot with its highlight overlays.
//
// The PNG and the JSON metadata both live in /audit-snapshots/{nodeId}.{png,json}
// and are committed to source. The JSON gets fetched once per node on first render
// and cached. Overlays are rendered as percentage-positioned rectangles + labels
// on top of the image, so they scale naturally with the thumbnail width.

import { useEffect, useState } from 'react';

export interface SnapshotHighlight {
  selector: string;
  label: string;
  callout: 'top' | 'bottom' | 'left' | 'right';
  rect: { x: number; y: number; width: number; height: number } | null;
}

export interface SnapshotMeta {
  nodeId: string;
  capturedAt: string;
  cockpitUrl: string;
  viewport: { width: number; height: number };
  highlights: SnapshotHighlight[];
}

const metaCache = new Map<string, SnapshotMeta | null>();

async function loadMeta(nodeId: string): Promise<SnapshotMeta | null> {
  if (metaCache.has(nodeId)) return metaCache.get(nodeId) ?? null;
  try {
    const res = await fetch(`/audit-snapshots/${nodeId}.json`);
    if (!res.ok) {
      metaCache.set(nodeId, null);
      return null;
    }
    const data = (await res.json()) as SnapshotMeta;
    metaCache.set(nodeId, data);
    return data;
  } catch {
    metaCache.set(nodeId, null);
    return null;
  }
}

export function Snapshot({
  nodeId,
  size = 'thumb',
  showAnnotations = true,
}: {
  nodeId: string;
  size?: 'thumb' | 'full';
  showAnnotations?: boolean;
}) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMeta(nodeId).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  return (
    <div
      className={`relative overflow-hidden rounded border border-border bg-ink ${
        size === 'thumb' ? 'aspect-[16/10]' : 'aspect-[16/10] w-full'
      }`}
    >
      <img
        src={`/audit-snapshots/${nodeId}.png`}
        alt={`cockpit snapshot for ${nodeId}`}
        className={`block h-full w-full object-cover ${exists === false ? 'opacity-0' : ''}`}
        onLoad={() => {
          setLoaded(true);
          setExists(true);
        }}
        onError={() => setExists(false)}
      />
      {exists === false && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-widest text-muted">
          no snapshot — run pnpm canvas:snapshot
        </div>
      )}
      {showAnnotations && meta && exists && (
        <Annotations meta={meta} thumb={size === 'thumb'} />
      )}
      {!loaded && exists !== false && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-widest text-muted">
          loading…
        </div>
      )}
    </div>
  );
}

function Annotations({ meta, thumb }: { meta: SnapshotMeta; thumb: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {meta.highlights.map((h, i) => {
        if (!h.rect) return null;
        const left = (h.rect.x / meta.viewport.width) * 100;
        const top = (h.rect.y / meta.viewport.height) * 100;
        const width = (h.rect.width / meta.viewport.width) * 100;
        const height = (h.rect.height / meta.viewport.height) * 100;
        // Only show labels on the full-size view; thumbs show just the boxes.
        const showLabel = !thumb;
        return (
          <div key={i}>
            <div
              className="absolute border-2 border-accent shadow-[0_0_6px_rgba(125,211,252,0.6)]"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
              }}
            />
            {showLabel && (
              <CalloutLabel
                left={left}
                top={top}
                width={width}
                height={height}
                label={h.label}
                callout={h.callout}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CalloutLabel({
  left,
  top,
  width,
  height,
  label,
  callout,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  callout: 'top' | 'bottom' | 'left' | 'right';
}) {
  // Position label relative to the rect, percent-based so it scales with image.
  let style: React.CSSProperties;
  switch (callout) {
    case 'top':
      style = {
        left: `${left + width / 2}%`,
        top: `${Math.max(0, top - 3)}%`,
        transform: 'translate(-50%, -100%)',
      };
      break;
    case 'bottom':
      style = {
        left: `${left + width / 2}%`,
        top: `${Math.min(95, top + height + 1)}%`,
        transform: 'translate(-50%, 0)',
      };
      break;
    case 'left':
      style = {
        left: `${Math.max(0, left - 1)}%`,
        top: `${top + height / 2}%`,
        transform: 'translate(-100%, -50%)',
      };
      break;
    case 'right':
      style = {
        left: `${Math.min(98, left + width + 1)}%`,
        top: `${top + height / 2}%`,
        transform: 'translate(0, -50%)',
      };
      break;
  }
  return (
    <div
      className="absolute whitespace-nowrap rounded border border-accent bg-ink/95 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent shadow-md"
      style={style}
    >
      {label}
    </div>
  );
}
