import { describe, expect, it } from 'vitest';
import { distance } from './hex.js';
import { ISLAND_RADIUS, islandCells, layoutIslands, localAxialToWorld } from './islands.js';

const projects = [
  { cockpitProjectId: 'p1', name: 'one' },
  { cockpitProjectId: 'p2', name: 'two' },
  { cockpitProjectId: 'p3', name: 'three' },
];

describe('layoutIslands', () => {
  it('centres a single project at origin', () => {
    const [a] = layoutIslands([projects[0]]);
    expect(a.worldCentre).toEqual([0, 0]);
  });

  it('places two projects side-by-side along the x axis', () => {
    const [a, b] = layoutIslands(projects.slice(0, 2));
    // The two centres are reflections through origin and have the same
    // |x| with z = 0.
    expect(a.worldCentre[1]).toBeCloseTo(0);
    expect(b.worldCentre[1]).toBeCloseTo(0);
    expect(Math.abs(a.worldCentre[0])).toBeCloseTo(Math.abs(b.worldCentre[0]));
  });

  it('arranges 3+ projects on a polar ring around origin', () => {
    const islands = layoutIslands(projects);
    expect(islands).toHaveLength(3);
    // Same distance from origin, no two coincident.
    const radii = islands.map(({ worldCentre: [x, z] }) => Math.hypot(x, z));
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeCloseTo(radii[0], 4);
    }
    const seen = new Set(islands.map((i) => `${i.worldCentre[0].toFixed(3)},${i.worldCentre[1].toFixed(3)}`));
    expect(seen.size).toBe(3);
  });

  it('is stable: sorted by id, so order does not depend on input order', () => {
    const a = layoutIslands(projects);
    const reversed = layoutIslands([...projects].reverse());
    // Sorted input ids: p1, p2, p3 in both cases.
    expect(a.map((i) => i.cockpitProjectId)).toEqual(reversed.map((i) => i.cockpitProjectId));
    expect(a.map((i) => i.worldCentre)).toEqual(reversed.map((i) => i.worldCentre));
  });
});

describe('islandCells', () => {
  it('returns 1 + 3·R·(R+1) cells for the configured island radius', () => {
    const [a] = layoutIslands([projects[0]]);
    expect(islandCells(a)).toHaveLength(1 + 3 * ISLAND_RADIUS * (ISLAND_RADIUS + 1));
  });

  it('all cells are within ISLAND_RADIUS of the centre', () => {
    const [a] = layoutIslands([projects[0]]);
    for (const c of islandCells(a)) {
      expect(distance(a.axialCentre, c)).toBeLessThanOrEqual(ISLAND_RADIUS);
    }
  });
});

describe('localAxialToWorld', () => {
  it('places the centre cell at the island worldCentre', () => {
    const [, b] = layoutIslands(projects.slice(0, 2));
    const [x, , z] = localAxialToWorld(b, b.axialCentre);
    expect(x).toBeCloseTo(b.worldCentre[0]);
    expect(z).toBeCloseTo(b.worldCentre[1]);
  });
});
