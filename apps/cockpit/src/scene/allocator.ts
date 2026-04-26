// Tile allocator for the territory map.
//
// Given:
//   - the cells available in a project's island
//   - one or more agent sessions with desired tile counts (= number
//     of cumulative changed files)
//
// Produce:
//   - a map of sessionId → claimed cells, where each session's tiles
//     form a contiguous region around a seed cell, and no cell is
//     claimed by more than one session.
//
// Strategy:
//   1. Place a seed cell per session, distributed so seeds are far
//      apart on the island (poisson-ish: pick the cell maximising the
//      minimum distance to existing seeds).
//   2. For each session, BFS outward from its seed, claiming the
//      closest unclaimed neighbour each step until its desired count
//      is reached.
//   3. Run all sessions in lock-step (round-robin) so a fast-growing
//      agent doesn't starve neighbours of their own border cells.
//
// The allocator is pure: same inputs → same outputs. No randomness,
// no state. Useful for the renderer and easy to test.

import { distance, key, neighbours, type AxialCoord } from './hex.js';

export interface AllocatorSession {
  id: string;
  // How many tiles this session wants to occupy. The allocator will
  // claim min(want, available) contiguous cells.
  want: number;
}

export interface AllocatorResult {
  // sessionId → list of axial coords, in claim order (oldest first).
  // Useful for animation: the renderer can stagger entry.
  claims: Map<string, AxialCoord[]>;
  // Cells the allocator chose as each session's seed.
  seeds: Map<string, AxialCoord>;
}

export interface AllocatorInput {
  islandCells: AxialCoord[];
  islandCentre: AxialCoord;
  sessions: AllocatorSession[];
}

export function allocate(input: AllocatorInput): AllocatorResult {
  const { islandCells, islandCentre, sessions } = input;
  const claims = new Map<string, AxialCoord[]>();
  const seeds = new Map<string, AxialCoord>();
  const claimed = new Set<string>(); // cell key → already taken

  if (sessions.length === 0 || islandCells.length === 0) {
    return { claims, seeds };
  }

  // Available cells indexed by key for fast lookup.
  const cellMap = new Map<string, AxialCoord>();
  for (const c of islandCells) cellMap.set(key(c), c);

  // Sort sessions by id so allocation is stable across runs (avoids
  // a fast-finishing session re-shuffling everyone else's territory
  // when it disappears).
  const order = sessions.slice().sort((a, b) => a.id.localeCompare(b.id));

  // 1. Seed placement — maximise the minimum distance between seeds.
  // For the first session, seed at the island centre. For each
  // subsequent session, scan all unclaimed cells and pick the one
  // whose nearest existing seed is furthest away.
  for (const s of order) {
    let pick: AxialCoord | null = null;
    if (seeds.size === 0) {
      // First session takes the centre.
      pick = cellMap.get(key(islandCentre)) ?? null;
    } else {
      let bestScore = -1;
      const seedList = Array.from(seeds.values());
      for (const cell of islandCells) {
        const k = key(cell);
        if (claimed.has(k)) continue;
        // Score = min distance to any existing seed. Larger = better.
        let minD = Infinity;
        for (const seed of seedList) {
          const d = distance(cell, seed);
          if (d < minD) minD = d;
        }
        if (minD > bestScore) {
          bestScore = minD;
          pick = cell;
        }
      }
    }
    if (!pick) {
      // Fallback: any unclaimed cell.
      pick = islandCells.find((c) => !claimed.has(key(c))) ?? null;
    }
    if (!pick) break; // island full
    seeds.set(s.id, pick);
    claims.set(s.id, [pick]);
    claimed.add(key(pick));
  }

  // 2. BFS frontier per session. Each session keeps a queue of
  // candidate frontier cells (unclaimed neighbours of its claimed
  // set), sorted by distance from its seed so it grows compactly.
  const frontiers = new Map<string, AxialCoord[]>();
  for (const s of order) {
    const seed = seeds.get(s.id);
    if (!seed) continue;
    frontiers.set(s.id, frontierOf(seed, claimed, cellMap));
  }

  // 3. Round-robin growth. Each tick, every session that still wants
  // tiles claims one more from its frontier. Stop when no session can
  // grow.
  const remaining = new Map<string, number>();
  for (const s of order) {
    const got = claims.get(s.id)?.length ?? 0;
    remaining.set(s.id, Math.max(0, s.want - got));
  }

  let progress = true;
  while (progress) {
    progress = false;
    for (const s of order) {
      const need = remaining.get(s.id) ?? 0;
      if (need <= 0) continue;
      const frontier = frontiers.get(s.id);
      if (!frontier || frontier.length === 0) continue;
      // Take the frontier head (closest to seed). It may have been
      // claimed by another session in this round; skip + retry.
      let next: AxialCoord | null = null;
      while (frontier.length > 0) {
        const candidate = frontier.shift()!;
        if (!claimed.has(key(candidate))) {
          next = candidate;
          break;
        }
      }
      if (!next) continue;
      claimed.add(key(next));
      claims.get(s.id)!.push(next);
      remaining.set(s.id, need - 1);
      // Add this cell's unclaimed neighbours to the frontier, sorted
      // so the closer-to-seed ones come first.
      const seed = seeds.get(s.id)!;
      const added = neighbours(next).filter(
        (n) => cellMap.has(key(n)) && !claimed.has(key(n)) && !inFrontier(frontier, n),
      );
      for (const n of added) frontier.push(n);
      frontier.sort((a, b) => distance(a, seed) - distance(b, seed));
      progress = true;
    }
  }

  return { claims, seeds };
}

function frontierOf(
  seed: AxialCoord,
  claimed: Set<string>,
  cellMap: Map<string, AxialCoord>,
): AxialCoord[] {
  const out: AxialCoord[] = [];
  for (const n of neighbours(seed)) {
    if (cellMap.has(key(n)) && !claimed.has(key(n))) out.push(n);
  }
  return out.sort((a, b) => distance(a, seed) - distance(b, seed));
}

function inFrontier(frontier: AxialCoord[], cell: AxialCoord): boolean {
  const k = key(cell);
  for (const f of frontier) if (key(f) === k) return true;
  return false;
}

// Centre of mass of a list of axial coords, returned as a fractional
// (q, r). Used by the renderer to position an agent's identity ring +
// tower at the visual centroid of its claimed tiles, smoothly lerped
// as the territory grows.
export function centroid(cells: AxialCoord[]): { q: number; r: number } {
  if (cells.length === 0) return { q: 0, r: 0 };
  let q = 0;
  let r = 0;
  for (const c of cells) {
    q += c.q;
    r += c.r;
  }
  return { q: q / cells.length, r: r / cells.length };
}

// Compute the set of cells that were claimed in the previous frame
// but aren't claimed by anyone in the current frame — these are the
// candidates for redistribution. Caller is expected to feed `freed`
// into redistribute() with the live survivors.
//
// Both inputs are keyed by sessionId → claim list. The caller need
// not filter survivors; we look at *all* current claims to decide
// what's freed (a session that just shuffled its territory shouldn't
// register as freeing cells).
export function freedCells(
  prev: Map<string, AxialCoord[]>,
  current: Map<string, AxialCoord[]>,
): AxialCoord[] {
  // Build a key-set of every cell currently claimed by any session.
  const live = new Set<string>();
  for (const cells of current.values()) {
    for (const c of cells) live.add(key(c));
  }
  // Walk previous claims; anything not in the live set is freed.
  const out: AxialCoord[] = [];
  const seen = new Set<string>();
  for (const cells of prev.values()) {
    for (const c of cells) {
      const k = key(c);
      if (live.has(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

// Land redistribution. Given the previous claims and the surviving
// agents' current claims, pick a neighbour-aware new owner for each
// freed cell: the surviving agent whose nearest claimed cell is
// closest to the freed cell. Ties broken by agent id (stable).
//
// Returns a map: freedCellKey → winningAgentId. Cells with no live
// neighbours (no surviving agents at all) drop out of the map and
// simply revert to empty terrain.
export interface RedistributeInput {
  // Cells that lost their owner (agent merged / departed).
  freed: AxialCoord[];
  // Surviving agents' current cell holdings.
  survivors: Map<string, AxialCoord[]>;
}

export function redistribute(input: RedistributeInput): Map<string, string> {
  const out = new Map<string, string>();
  const survivorIds = Array.from(input.survivors.keys()).sort();
  if (survivorIds.length === 0 || input.freed.length === 0) return out;

  for (const cell of input.freed) {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const id of survivorIds) {
      const claims = input.survivors.get(id);
      if (!claims || claims.length === 0) continue;
      // Distance from this freed cell to the agent's nearest claim.
      let d = Infinity;
      for (const c of claims) {
        const dd = distance(cell, c);
        if (dd < d) d = dd;
      }
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    if (bestId) out.set(key(cell), bestId);
  }
  return out;
}
