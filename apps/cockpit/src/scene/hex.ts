// Pointy-topped hex grid in axial (q, r) coordinates.
//
// Conventions used in the canvas:
//   - World plane: y is up; the grid lies on XZ.
//   - Axial coords: q runs along world +X (with a slight +Z slope per
//     row), r runs along world +Z (with a slight +X slope per col).
//   - Pointy-top means hex points along ±Z (north/south); flat sides
//     are along world +X. This matches our existing hex tile mesh
//     which uses cylinderGeometry(radius, radius, h, 6) — a 6-segment
//     cylinder defaults to pointy-top when rotation is 0.
//
// Hex cell dimensions:
//   - HEX_SIZE is the radius (centre→corner). Set so two adjacent
//     hexes touch corner-to-flat with HEX_SIZE = 0.55, matching the
//     existing TILE_RADIUS used in PortfolioMap. Width (flat side)
//     = sqrt(3) · HEX_SIZE; height (point-to-point) = 2 · HEX_SIZE.
//
// All exports are pure: no React, no THREE.

export const HEX_SIZE = 0.55;
export const HEX_W = Math.sqrt(3) * HEX_SIZE; // distance between flat sides
export const HEX_H = 2 * HEX_SIZE; // distance between pointy sides

export interface AxialCoord {
  q: number;
  r: number;
}

export function key(c: AxialCoord): string {
  return `${c.q},${c.r}`;
}

// Pointy-top → world. Origin (0,0) at world (0,0,0).
export function axialToWorld(c: AxialCoord): [number, number, number] {
  const x = HEX_W * (c.q + c.r / 2);
  const z = HEX_H * 0.75 * c.r;
  return [x, 0, z];
}

// World (x, z) → nearest integer axial coord. Used to snap island
// centres onto the global hex grid so per-island cells line up with
// the floor's hex pattern.
export function worldToAxialRound(x: number, z: number): AxialCoord {
  // Inverse of axialToWorld for pointy-top, then cube-round.
  const r = (z / (HEX_H * 0.75));
  const q = x / HEX_W - r / 2;
  // Cube-round on (q, r, -q-r).
  const qy = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let ry = Math.round(qy);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const dy = Math.abs(ry - qy);
  if (dq > dr && dq > dy) rq = -rr - ry;
  else if (dr > dy) rr = -rq - ry;
  return { q: rq, r: rr };
}

// Six axial neighbour deltas (clockwise from +q,0).
export const NEIGHBOURS: AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbours(c: AxialCoord): AxialCoord[] {
  return NEIGHBOURS.map((d) => ({ q: c.q + d.q, r: c.r + d.r }));
}

// All hexes within `radius` rings of a centre (including centre).
// radius=0 → 1 hex, 1 → 7, 2 → 19, ... 1 + 3·R·(R+1).
export function ringFill(centre: AxialCoord, radius: number): AxialCoord[] {
  const out: AxialCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      out.push({ q: centre.q + q, r: centre.r + r });
    }
  }
  return out;
}

// Hexes on a single ring at distance `radius`. Used for rendering
// island outlines and for spatial allocation: tiles claimed in
// breadth-first order from a centre claim outward.
export function ringAt(centre: AxialCoord, radius: number): AxialCoord[] {
  if (radius <= 0) return [{ q: centre.q, r: centre.r }];
  const out: AxialCoord[] = [];
  // Walk one corner, then six edges of length `radius`.
  let cur: AxialCoord = {
    q: centre.q + NEIGHBOURS[4].q * radius,
    r: centre.r + NEIGHBOURS[4].r * radius,
  };
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push(cur);
      cur = { q: cur.q + NEIGHBOURS[i].q, r: cur.r + NEIGHBOURS[i].r };
    }
  }
  return out;
}

// Cube-distance between two axial coords. Used by the tile allocator
// to break ties when many empty cells are adjacent to a territory:
// pick the one closest to the territory's existing centre-of-mass.
export function distance(a: AxialCoord, b: AxialCoord): number {
  // Convert to cube: x=q, z=r, y=-x-z. Distance = max(|dx|, |dy|, |dz|).
  const ax = a.q;
  const az = a.r;
  const ay = -ax - az;
  const bx = b.q;
  const bz = b.r;
  const by = -bx - bz;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

// Pointy-top hex outline as 6 (x, z) points relative to its centre.
// Used by the TerritoryIsland renderer for hex outline geometry.
export function hexCorners(): [number, number][] {
  // Pointy-top corners: angles at 30°, 90°, 150°, 210°, 270°, 330° from +x.
  const out: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 + 30) * Math.PI) / 180;
    out.push([Math.cos(a) * HEX_SIZE, Math.sin(a) * HEX_SIZE]);
  }
  return out;
}
