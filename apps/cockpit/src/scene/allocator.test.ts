import { describe, expect, it } from 'vitest';
import { allocate, centroid, freedCells, redistribute } from './allocator.js';
import { distance, key, type AxialCoord } from './hex.js';
import { ISLAND_RADIUS, islandCells, layoutIslands } from './islands.js';

const project = { cockpitProjectId: 'p', name: 'p' };
const island = layoutIslands([project])[0];
const cells = islandCells(island);

describe('allocate', () => {
  it('returns no claims for no sessions', () => {
    const r = allocate({ islandCells: cells, islandCentre: island.axialCentre, sessions: [] });
    expect(r.claims.size).toBe(0);
    expect(r.seeds.size).toBe(0);
  });

  it("seeds the first session at the island centre", () => {
    const r = allocate({
      islandCells: cells,
      islandCentre: island.axialCentre,
      sessions: [{ id: 'a', want: 1 }],
    });
    expect(r.seeds.get('a')).toEqual(island.axialCentre);
    expect(r.claims.get('a')).toHaveLength(1);
  });

  it('grows a single session as a contiguous BFS from its seed', () => {
    const r = allocate({
      islandCells: cells,
      islandCentre: island.axialCentre,
      sessions: [{ id: 'a', want: 19 }],
    });
    const claimed = r.claims.get('a')!;
    expect(claimed).toHaveLength(19);
    // Every claim after the first must touch at least one earlier claim.
    const seen = new Set<string>([key(claimed[0])]);
    for (let i = 1; i < claimed.length; i++) {
      const c = claimed[i];
      const isContiguous = [-1, 0, 1].some((dq) =>
        [-1, 0, 1].some((dr) => seen.has(key({ q: c.q + dq, r: c.r + dr }))),
      );
      expect(isContiguous).toBe(true);
      seen.add(key(c));
    }
  });

  it('does not double-claim a cell across sessions', () => {
    const r = allocate({
      islandCells: cells,
      islandCentre: island.axialCentre,
      sessions: [
        { id: 'a', want: 30 },
        { id: 'b', want: 30 },
        { id: 'c', want: 30 },
      ],
    });
    const all = new Set<string>();
    for (const list of r.claims.values()) {
      for (const c of list) {
        const k = key(c);
        expect(all.has(k)).toBe(false); // would mean a duplicate
        all.add(k);
      }
    }
  });

  it("places multiple sessions' seeds far apart on the island", () => {
    const r = allocate({
      islandCells: cells,
      islandCentre: island.axialCentre,
      sessions: [
        { id: 'a', want: 1 },
        { id: 'b', want: 1 },
        { id: 'c', want: 1 },
      ],
    });
    const seedList = Array.from(r.seeds.values());
    // For an island of radius 6 with 3 seeds, each pair should be at
    // least a few rings apart — not adjacent.
    for (let i = 0; i < seedList.length; i++) {
      for (let j = i + 1; j < seedList.length; j++) {
        expect(distance(seedList[i], seedList[j])).toBeGreaterThanOrEqual(ISLAND_RADIUS - 2);
      }
    }
  });

  it('caps each session at min(want, available) when the island runs out', () => {
    // 1 + 3·6·7 = 127 cells. Two sessions wanting 100 each can't both
    // fit; the round-robin should distribute fairly.
    const r = allocate({
      islandCells: cells,
      islandCentre: island.axialCentre,
      sessions: [
        { id: 'a', want: 100 },
        { id: 'b', want: 100 },
      ],
    });
    const a = r.claims.get('a')!.length;
    const b = r.claims.get('b')!.length;
    expect(a + b).toBeLessThanOrEqual(cells.length);
    // Round-robin growth: neither should be more than 1 ahead of the other.
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it('is stable: identical inputs produce identical outputs', () => {
    const input = {
      islandCells: cells,
      islandCentre: island.axialCentre,
      sessions: [
        { id: 'b', want: 10 },
        { id: 'a', want: 10 },
      ],
    };
    const r1 = allocate(input);
    const r2 = allocate({ ...input, sessions: input.sessions.slice().reverse() });
    // The id-based sort means input order doesn't affect output.
    expect(r1.claims.get('a')).toEqual(r2.claims.get('a'));
    expect(r1.claims.get('b')).toEqual(r2.claims.get('b'));
  });
});

describe('freedCells', () => {
  const c00: AxialCoord = { q: 0, r: 0 };
  const c10: AxialCoord = { q: 1, r: 0 };
  const c01: AxialCoord = { q: 0, r: 1 };
  const c11: AxialCoord = { q: 1, r: 1 };

  it('returns nothing when prev and current are equal', () => {
    const prev = new Map([['a', [c00, c10]]]);
    const cur = new Map([['a', [c00, c10]]]);
    expect(freedCells(prev, cur)).toEqual([]);
  });

  it('returns cells that disappeared from any session', () => {
    const prev = new Map([['a', [c00, c10, c01]]]);
    const cur = new Map([['a', [c00]]]);
    const freed = freedCells(prev, cur);
    expect(freed.map(key).sort()).toEqual([key(c10), key(c01)].sort());
  });

  it('does NOT count cells reassigned to a different surviving agent', () => {
    // c10 was held by a; now b holds it. That's not "freed" — it's still
    // claimed (just by someone else), so redistribution shouldn't pick
    // it up.
    const prev = new Map([['a', [c00, c10]]]);
    const cur = new Map([
      ['a', [c00]],
      ['b', [c10]],
    ]);
    const freed = freedCells(prev, cur);
    expect(freed).toEqual([]);
  });

  it('returns the entire territory of a vanished session', () => {
    const prev = new Map([
      ['a', [c00, c10]],
      ['b', [c01, c11]],
    ]);
    const cur = new Map([['a', [c00, c10]]]);
    const freed = freedCells(prev, cur);
    expect(freed.map(key).sort()).toEqual([key(c01), key(c11)].sort());
  });

  it('deduplicates if the same cell appears in multiple prev claim lists', () => {
    // (Shouldn't happen in normal flow, but the helper guards against
    // double-counting if upstream gets confused.)
    const prev = new Map([
      ['a', [c00]],
      ['b', [c00]],
    ]);
    const cur = new Map<string, AxialCoord[]>();
    const freed = freedCells(prev, cur);
    expect(freed).toHaveLength(1);
    expect(key(freed[0])).toBe(key(c00));
  });
});

describe('redistribute', () => {
  it('returns no winners when there are no survivors', () => {
    const r = redistribute({
      freed: [{ q: 0, r: 0 }],
      survivors: new Map(),
    });
    expect(r.size).toBe(0);
  });

  it('returns no winners when there are no freed cells', () => {
    const r = redistribute({
      freed: [],
      survivors: new Map([['a', [{ q: 0, r: 0 }]]]),
    });
    expect(r.size).toBe(0);
  });

  it('hands each freed cell to the closest-by-axial-distance surviving agent', () => {
    const a: AxialCoord[] = [{ q: -3, r: 0 }];
    const b: AxialCoord[] = [{ q: 3, r: 0 }];
    const freed: AxialCoord[] = [
      { q: -2, r: 0 }, // closer to a
      { q: 2, r: 0 }, // closer to b
      { q: 0, r: 0 }, // tied — id-sorted, 'a' wins
    ];
    const r = redistribute({
      freed,
      survivors: new Map([
        ['a', a],
        ['b', b],
      ]),
    });
    expect(r.get(key({ q: -2, r: 0 }))).toBe('a');
    expect(r.get(key({ q: 2, r: 0 }))).toBe('b');
    expect(r.get(key({ q: 0, r: 0 }))).toBe('a');
  });

  it('skips agents that hold no cells', () => {
    const r = redistribute({
      freed: [{ q: 0, r: 0 }],
      survivors: new Map([
        ['empty', []],
        ['real', [{ q: 5, r: -5 }]],
      ]),
    });
    expect(r.get(key({ q: 0, r: 0 }))).toBe('real');
  });

  it('is stable when multiple agents tie on distance — id-sorted', () => {
    const z = [{ q: 0, r: 1 }];
    const a = [{ q: 0, r: -1 }];
    const r1 = redistribute({
      freed: [{ q: 0, r: 0 }],
      survivors: new Map([
        ['z', z],
        ['a', a],
      ]),
    });
    const r2 = redistribute({
      freed: [{ q: 0, r: 0 }],
      survivors: new Map([
        ['a', a],
        ['z', z],
      ]),
    });
    expect(r1.get(key({ q: 0, r: 0 }))).toBe(r2.get(key({ q: 0, r: 0 })));
    expect(r1.get(key({ q: 0, r: 0 }))).toBe('a');
  });
});

describe('centroid', () => {
  it('returns origin for an empty list', () => {
    expect(centroid([])).toEqual({ q: 0, r: 0 });
  });
  it('averages axial coords', () => {
    const cs: AxialCoord[] = [
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      { q: 0, r: 4 },
    ];
    expect(centroid(cs)).toEqual({ q: 2 / 3, r: 4 / 3 });
  });
});
