// Auto-layout for the audit canvas.
//
// We use dagre's layered layout with `rankdir: LR` so the graph reads
// left-to-right, plus a manual rank assignment per node so the stage
// columns (fleet → scoping → impl → verify → post) are preserved
// regardless of how the edges connect them. Cross-cutting nodes get a
// dedicated above-the-flow row.

import dagre from '@dagrejs/dagre';
import type { AuditEdgeSpec, AuditNodeSpec, Stage } from './nodes';

const NODE_W = 300;
const NODE_H = 360;

// Stage → column rank. Cross-cutting nodes are pinned above the main flow.
const stageRank: Record<Stage, number> = {
  fleet: 0,
  scoping: 1,
  implementation: 2,
  verification: 3,
  'cross-cutting': 0, // x is overridden after layout — see below
};

export function layoutNodes(
  nodes: AuditNodeSpec[],
  edges: AuditEdgeSpec[],
): AuditNodeSpec[] {
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: 'LR',
    nodesep: 100, // vertical space between same-rank nodes
    ranksep: 200, // horizontal space between ranks
    edgesep: 30,
    marginx: 60,
    marginy: 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Pin each node into its stage's rank by adding invisible "spine" nodes
  // that anchor the rank, then connecting our real node to its anchor.
  // Simpler approach: just rely on dagre's longest-path ranking by
  // adding the actual edges; our explicit edges already produce the
  // intended left-to-right order. We use the explicit `rank` attribute
  // to keep cross-cutting nodes above and stage nodes in the right
  // column.
  for (const n of nodes) {
    const isCrossCutting = n.stage === 'cross-cutting';
    g.setNode(n.id, {
      width: NODE_W,
      height: NODE_H,
      // dagre-specific: rank pins horizontal position. min/max push to
      // top of the layered layout for cross-cutting; default for the rest.
      rank: isCrossCutting ? 'min' : undefined,
    });
  }

  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  // Read positions back out, recentre on (x, y) since dagre reports the
  // node's centre point.
  const positioned = nodes.map((n) => {
    const layoutNode = g.node(n.id);
    return {
      ...n,
      position: {
        x: layoutNode.x - NODE_W / 2,
        y: layoutNode.y - NODE_H / 2,
      },
    };
  });

  // Cross-cutting nodes: dagre will have laid them at rank=min (leftmost
  // column). We want them spread across the top of the *whole* graph
  // instead, so they form a strip rather than stacking in column 0.
  const crossCutting = positioned.filter((n) => n.stage === 'cross-cutting');
  const stageNodes = positioned.filter((n) => n.stage !== 'cross-cutting');

  if (crossCutting.length > 0 && stageNodes.length > 0) {
    const minX = Math.min(...stageNodes.map((n) => n.position.x));
    const maxX = Math.max(...stageNodes.map((n) => n.position.x));
    const minY = Math.min(...stageNodes.map((n) => n.position.y));
    const stripY = minY - NODE_H - 80;
    const stripWidth = maxX - minX;
    const step = crossCutting.length > 1 ? stripWidth / (crossCutting.length - 1) : 0;
    crossCutting.forEach((n, i) => {
      n.position = {
        x: minX + step * i,
        y: stripY,
      };
    });
  }

  // Implicitly preserve the column meaning by sorting stage nodes' x
  // coordinates by stage rank (dagre may have reordered if edges pull
  // a node to a non-natural column).
  const stageX: Record<Stage, number[]> = {
    fleet: [],
    scoping: [],
    implementation: [],
    verification: [],
    'cross-cutting': [],
  };
  for (const n of stageNodes) {
    stageX[n.stage].push(n.position.x);
  }
  // Compute the centroid x per stage in dagre's output, then snap each
  // stage's nodes to a single column at that centroid.
  const colX: Record<Stage, number> = {
    fleet: 0,
    scoping: 0,
    implementation: 0,
    verification: 0,
    'cross-cutting': 0,
  };
  for (const stage of Object.keys(stageX) as Stage[]) {
    const xs = stageX[stage];
    if (xs.length > 0) colX[stage] = xs.reduce((a, b) => a + b, 0) / xs.length;
  }
  // If dagre got the column ordering "wrong" (stages out of stageRank
  // order), force-sort by reassigning columns at evenly-spaced X
  // positions in stage order.
  const orderedStages: Stage[] = ['fleet', 'scoping', 'implementation', 'verification'];
  const colSpacing = NODE_W + 140;
  for (let i = 0; i < orderedStages.length; i++) {
    const stage = orderedStages[i];
    if (stageX[stage].length > 0) {
      colX[stage] = i * colSpacing;
    }
  }
  for (const n of stageNodes) {
    n.position = { ...n.position, x: colX[n.stage] };
  }

  // Re-do the cross-cutting strip relative to the post-snap layout
  if (crossCutting.length > 0) {
    const minX = Math.min(...stageNodes.map((n) => n.position.x));
    const maxX = Math.max(...stageNodes.map((n) => n.position.x));
    const minY = Math.min(...stageNodes.map((n) => n.position.y));
    const stripY = minY - NODE_H - 80;
    const stripWidth = maxX - minX;
    const step = crossCutting.length > 1 ? stripWidth / (crossCutting.length - 1) : 0;
    crossCutting.forEach((n, i) => {
      n.position = { x: minX + step * i, y: stripY };
    });
  }

  return [...stageNodes, ...crossCutting];
}
