// Project island layout. Each project becomes a hex island in the
// world; agents claim contiguous tiles within their project's island
// (slice 3 logic). This module decides where each island sits.
//
// Layout strategy:
//   - 1 project: centred at origin.
//   - 2 projects: side-by-side along ±x.
//   - ≥3 projects: arranged on a ring around origin, polar.
//   - Each island has the same axial radius (ISLAND_RADIUS rings),
//     giving 1 + 3·R·(R+1) cells (e.g. R=6 → 127 cells per project).
//
// World-space spacing is computed from the island's hex footprint
// width plus a constant gap so neighbouring islands never overlap.

import { axialToWorld, HEX_W, ringFill, worldToAxialRound, type AxialCoord } from './hex.js';

// Number of rings around each island's centre hex. R=6 → 127 cells —
// enough to host ~5 agents with ~25 tiles each.
export const ISLAND_RADIUS = 6;

// World-space gap between island bounding circles.
const ISLAND_GAP = HEX_W * 1.6;

export interface ProjectIsland {
  cockpitProjectId: string;
  name: string;
  // Centre of the island, in world coords on the XZ plane. y always 0.
  worldCentre: [number, number];
  // Centre cell in the island's local axial frame. The island's cells
  // are buildIslandCells(worldCentre, ISLAND_RADIUS).
  axialCentre: AxialCoord;
  // Worldspace radius of the island's bounding circle. Used by the
  // camera to frame the fleet.
  worldRadius: number;
}

// Approximate worldspace radius of a hex island with R rings: the
// far-side flat distance from centre = R · HEX_W (for pointy-top).
export function islandWorldRadius(rings: number): number {
  return rings * HEX_W + HEX_W / 2;
}

export function layoutIslands(
  projects: { cockpitProjectId: string; name: string }[],
): ProjectIsland[] {
  const ids = projects.map((p) => p.cockpitProjectId).sort();
  // Sorting by id makes layout stable across re-renders; otherwise a
  // late-arriving project could shuffle every island's position.
  const sortedProjects = ids.map((id) => projects.find((p) => p.cockpitProjectId === id)!);
  const n = sortedProjects.length;

  const r = islandWorldRadius(ISLAND_RADIUS);
  const ringRadius = (r * 2 + ISLAND_GAP) / 2 / Math.sin(Math.PI / Math.max(3, n));

  return sortedProjects.map((p, i) => {
    let cx: number;
    let cz: number;
    if (n === 1) {
      cx = 0;
      cz = 0;
    } else if (n === 2) {
      cx = i === 0 ? -(r + ISLAND_GAP / 2) : r + ISLAND_GAP / 2;
      cz = 0;
    } else {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      cx = Math.cos(angle) * ringRadius;
      cz = Math.sin(angle) * ringRadius;
    }
    // Snap the desired world centre to the nearest integer axial
    // coord on the global hex grid, then re-emit a world position
    // from that axial. This guarantees each island's cells line up
    // with the floor wireframe and with neighbouring islands.
    const snappedAxial = worldToAxialRound(cx, cz);
    const [sx, , sz] = axialToWorld(snappedAxial);
    return {
      cockpitProjectId: p.cockpitProjectId,
      name: p.name,
      worldCentre: [sx, sz],
      // The island's local "centre" is its global axial offset; its
      // cells are still ringFill({0,0}, R) translated by worldCentre.
      axialCentre: { q: 0, r: 0 },
      worldRadius: r,
    };
  });
}

// All cells within an island, in island-local axial coords. Translate
// each to world via axialToWorld(cell) + island.worldCentre.
export function islandCells(island: ProjectIsland): AxialCoord[] {
  return ringFill(island.axialCentre, ISLAND_RADIUS);
}

// Convert an island-local axial coord to world XZ, given the island.
export function localAxialToWorld(
  island: ProjectIsland,
  cell: AxialCoord,
): [number, number, number] {
  const [lx, , lz] = axialToWorld(cell);
  return [island.worldCentre[0] + lx, 0, island.worldCentre[1] + lz];
}
