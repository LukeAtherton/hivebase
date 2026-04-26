// Pure math tests for the hex coord module. These pin the conventions
// (axial coordinates, pointy-top, ring counts, cube distance) so the
// island layout + tile allocator can rely on them.

import { describe, expect, it } from 'vitest';
import {
  axialToWorld,
  distance,
  hexCorners,
  HEX_H,
  HEX_W,
  key,
  neighbours,
  ringAt,
  ringFill,
} from './hex.js';

describe('axialToWorld', () => {
  it('places the origin hex at (0, 0, 0)', () => {
    expect(axialToWorld({ q: 0, r: 0 })).toEqual([0, 0, 0]);
  });

  it('walks +q along +x and +r along +z (with a half-x stagger)', () => {
    const a = axialToWorld({ q: 1, r: 0 });
    expect(a[0]).toBeCloseTo(HEX_W);
    expect(a[2]).toBeCloseTo(0);

    const b = axialToWorld({ q: 0, r: 1 });
    expect(b[0]).toBeCloseTo(HEX_W / 2);
    expect(b[2]).toBeCloseTo((HEX_H * 3) / 4);
  });
});

describe('neighbours', () => {
  it('returns the 6 immediate neighbours, all at distance 1', () => {
    const c = { q: 4, r: -2 };
    const ns = neighbours(c);
    expect(ns).toHaveLength(6);
    for (const n of ns) {
      expect(distance(c, n)).toBe(1);
    }
    // No duplicates.
    const seen = new Set(ns.map(key));
    expect(seen.size).toBe(6);
  });
});

describe('ringFill', () => {
  it('returns 1 cell at radius 0', () => {
    expect(ringFill({ q: 0, r: 0 }, 0)).toEqual([{ q: 0, r: 0 }]);
  });

  it('matches 1 + 3·R·(R+1) for radius 1..6', () => {
    for (let R = 1; R <= 6; R++) {
      expect(ringFill({ q: 0, r: 0 }, R)).toHaveLength(1 + 3 * R * (R + 1));
    }
  });
});

describe('ringAt', () => {
  it('returns 6·R cells per ring at R≥1', () => {
    for (let R = 1; R <= 6; R++) {
      expect(ringAt({ q: 0, r: 0 }, R)).toHaveLength(6 * R);
    }
  });
  it('returns the centre alone at R=0', () => {
    expect(ringAt({ q: 0, r: 0 }, 0)).toEqual([{ q: 0, r: 0 }]);
  });
  it('all cells on ring R are at axial-distance R from centre', () => {
    const R = 4;
    const centre = { q: 5, r: 5 };
    for (const cell of ringAt(centre, R)) {
      expect(distance(centre, cell)).toBe(R);
    }
  });
});

describe('hexCorners', () => {
  it('returns 6 corners distributed around the centre', () => {
    const corners = hexCorners();
    expect(corners).toHaveLength(6);
    // All at HEX_SIZE distance from origin.
    for (const [x, z] of corners) {
      const d = Math.sqrt(x * x + z * z);
      expect(d).toBeCloseTo(0.55, 4); // HEX_SIZE
    }
  });
});
