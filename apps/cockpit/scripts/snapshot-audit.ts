/**
 * Audit canvas snapshot pipeline.
 *
 * For each AuditNodeSpec with seedSessionIx, drive a headless Chromium
 * to /?session=ckse_seed_{ix}_____________, wait for the cockpit to
 * settle, then:
 *   1. Take a viewport-sized PNG → public/audit-snapshots/{nodeId}.png
 *   2. For each highlight selector, compute the bounding box and write
 *      an accompanying JSON → public/audit-snapshots/{nodeId}.json
 *
 * The canvas card later renders the PNG with the JSON overlay, so the
 * snapshot pipeline has to commit both.
 *
 * Usage (cockpit + cockpit-api must already be running):
 *   pnpm --filter @kybernos/cockpit canvas:snapshot
 *
 * Reproducible: writes against fixed-id seeded data.
 */

import { chromium, type Page } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditNodes, type AuditNodeSpec } from '../src/audit/nodes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'audit-snapshots');
const COCKPIT_URL = process.env.COCKPIT_URL ?? 'http://localhost:4400';
const VIEWPORT = { width: 1440, height: 900 };

interface CapturedHighlight {
  selector: string;
  label: string;
  callout: 'top' | 'bottom' | 'left' | 'right';
  rect: { x: number; y: number; width: number; height: number } | null;
}

interface SnapshotMeta {
  nodeId: string;
  capturedAt: string;
  cockpitUrl: string;
  viewport: typeof VIEWPORT;
  highlights: CapturedHighlight[];
}

function sessionIdForIx(ix: number): string {
  return `ckse_seed_${String(ix).padStart(2, '0')}_____________`;
}

async function captureNode(page: Page, node: AuditNodeSpec): Promise<void> {
  // Capture if either:
  //  (a) the node has a seedSessionIx — drive the cockpit to that session
  //  (b) the node has highlights but no seed — capture the default cockpit view
  const hasHighlights = (node.highlights ?? []).length > 0;
  if (!node.seedSessionIx && !hasHighlights) return;

  const url = node.seedSessionIx
    ? `${COCKPIT_URL}/?session=${sessionIdForIx(node.seedSessionIx)}`
    : `${COCKPIT_URL}/`;
  const tag = node.seedSessionIx ? `S${String(node.seedSessionIx).padStart(2, '0')}` : '(default view)';
  process.stdout.write(`  ${node.id.padEnd(28)} → ${tag.padEnd(15)} … `);

  // The cockpit holds an open WebSocket so 'networkidle' never resolves.
  // Use 'domcontentloaded' + an explicit wait for the always-rendered
  // SummaryLine, then a settle timeout for R3F + react-query data.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.waitForSelector('[data-audit-id="summary-line"]', { timeout: 15_000 });
  await page.waitForTimeout(2_000);

  const pngPath = path.join(OUT_DIR, `${node.id}.png`);
  await page.screenshot({ path: pngPath, fullPage: false });

  const captured: CapturedHighlight[] = [];
  for (const h of node.highlights ?? []) {
    const rect = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, h.selector);
    captured.push({
      selector: h.selector,
      label: h.label,
      callout: h.callout ?? 'top',
      rect,
    });
  }

  const meta: SnapshotMeta = {
    nodeId: node.id,
    capturedAt: new Date().toISOString(),
    cockpitUrl: url,
    viewport: VIEWPORT,
    highlights: captured,
  };
  await writeFile(path.join(OUT_DIR, `${node.id}.json`), JSON.stringify(meta, null, 2));

  const goodHighlights = captured.filter((h) => h.rect !== null).length;
  console.log(`ok (${captured.length} highlights, ${goodHighlights} resolved)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const targets = auditNodes.filter(
    (n) => n.seedSessionIx || (n.highlights ?? []).length > 0,
  );
  console.log(`Capturing ${targets.length} nodes against ${COCKPIT_URL}…`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  for (const n of targets) {
    try {
      await captureNode(page, n);
    } catch (err) {
      console.log(`FAILED — ${(err as Error).message}`);
    }
  }

  await browser.close();
  console.log(`Done. PNGs and JSON in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
