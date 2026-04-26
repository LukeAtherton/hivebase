import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { api, type SessionIntel, type SessionRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';
import { allocate, freedCells, redistribute, type AllocatorResult } from './allocator.js';
import {
  axialToWorld,
  hexCorners,
  HEX_SIZE,
  HEX_W,
  key as cellKey,
  ringFill,
  type AxialCoord,
} from './hex.js';
import {
  islandCells,
  islandWorldRadius,
  ISLAND_RADIUS,
  layoutIslands,
  localAxialToWorld,
} from './islands.js';

// Mission-control portfolio map.
//
// Territories: one labelled disc per project, laid out on a horizontal grid.
// Tiles:       one hex per session, ringed around its territory's circumference,
//              ordered by state-class. Tile colour = state, pulse = needs-decision,
//              opacity = staleness.
//
// Camera: locked oblique angle (Supreme Commander strategic view). Pan + zoom,
// no rotate, so the operator's spatial mental model never inverts.

const STATE_COLOURS: Record<string, string> = {
  queued: '#5a6573',
  orienting: '#7dd3fc', // accent / info
  implementing: '#22c55e', // ok
  validating: '#a3e635',
  blocked: '#ef4444', // alarm
  'needs-decision': '#f59e0b', // warn
  'ready-for-review': '#c084fc',
  merged: '#5a6573',
  'stale-zombie': '#3a4250',
  stopped: '#3a4250',
};

// Order tiles around their territory by liveness so the eye reads the
// active-front edge first.
const STATE_ORDER: Record<string, number> = {
  'needs-decision': 0,
  blocked: 1,
  'ready-for-review': 2,
  validating: 3,
  implementing: 4,
  orienting: 5,
  queued: 6,
  stopped: 7,
  merged: 8,
  'stale-zombie': 9,
};

interface Territory {
  cockpitProjectId: string;
  name: string;
  centre: [number, number];
  radius: number;
  sessions: SessionRow[];
  liveCount: number;
  decisionCount: number;
}

// World-space radius of a project island (kept for back-compat with
// camera framing + tile allocation). Computed from the hex grid rather
// than declared as a magic constant.
const TERRITORY_RADIUS = islandWorldRadius(ISLAND_RADIUS);
const TILE_RADIUS = HEX_SIZE;
const TILE_HEIGHT = 0.28;
// Base extrusion depth for terrain glass tiles. Per-cell variation
// scales this (cell.depth ∈ [1, 5]) so cells range from BASE to 5×.
const BASE_TILE_DEPTH = 0.14;
// World y at which agent hex towers float above the terrain. Picked
// to clear the tallest possible tile (5 × BASE_TILE_DEPTH = 0.7).
const FLOAT_HEIGHT = 0.9;

// Sessions older than this with no recent activity are filtered from the live
// portfolio map — they belong on a separate history view (later cycle).
const ZOMBIE_AGE_MS = 1000 * 60 * 60; // 1h

function isLiveOnMap(s: SessionRow): boolean {
  if (s.state === 'merged') return false;
  if (s.state === 'stopped' || s.state === 'stale-zombie') {
    if (!s.lastEventAt) return false;
    const age = Date.now() - Date.parse(s.lastEventAt);
    return age < ZOMBIE_AGE_MS;
  }
  return true;
}

function buildTerritories(sessions: SessionRow[]): Territory[] {
  const live = sessions.filter(isLiveOnMap);
  const byProject = new Map<string, SessionRow[]>();
  for (const s of live) {
    const list = byProject.get(s.cockpitProjectId) ?? [];
    list.push(s);
    byProject.set(s.cockpitProjectId, list);
  }
  const projectIds = Array.from(byProject.keys()).sort();

  // Hex-island layout. Each project gets its own region of hex space;
  // tile allocation (slice 3) will claim contiguous cells inside each
  // island for individual agent territories.
  const islands = layoutIslands(
    projectIds.map((id) => ({
      cockpitProjectId: id,
      name: byProject.get(id)![0]?.projectName ?? id.slice(-6),
    })),
  );

  return islands.map((island) => {
    const sessionsForProject = byProject
      .get(island.cockpitProjectId)!
      .slice()
      .sort((a, b) => {
        const sa = STATE_ORDER[a.state] ?? 99;
        const sb = STATE_ORDER[b.state] ?? 99;
        return sa - sb;
      });
    return {
      cockpitProjectId: island.cockpitProjectId,
      name: island.name,
      centre: island.worldCentre,
      radius: island.worldRadius,
      sessions: sessionsForProject,
      liveCount: sessionsForProject.filter(
        (s) => !['stopped', 'merged', 'stale-zombie'].includes(s.state),
      ).length,
      decisionCount: sessionsForProject.filter((s) => s.state === 'needs-decision').length,
    };
  });
}

function tileSlot(index: number, total: number, territory: Territory): [number, number, number] {
  if (total === 1) return [territory.centre[0], 0, territory.centre[1]];
  // Distribute around territory circumference. With many sessions, spiral
  // inwards in concentric rings so tiles never crowd.
  const slotsPerRing = 12;
  const ring = Math.floor(index / slotsPerRing);
  const inRing = index % slotsPerRing;
  const r = territory.radius * (1 - ring * 0.25);
  const angle = (inRing / Math.min(total - ring * slotsPerRing, slotsPerRing)) * Math.PI * 2;
  return [territory.centre[0] + Math.cos(angle) * r, 0, territory.centre[1] + Math.sin(angle) * r];
}

// Strategic-zoom dolly with auto-orbit drift (project-visualizer
// circuit-board pattern). When idle, the camera slowly rotates around the
// fleet centre with a gentle radius/height oscillation so the scene never
// feels static. When a session is selected, the orbit re-centres on that
// tile at a tighter radius — the cinematic motion continues.
function CameraDolly({
  sceneRadius,
  focusPosition,
  isFocused,
  xBias,
}: {
  sceneRadius: number;
  focusPosition: [number, number, number] | null;
  isFocused: boolean;
  // World-unit shift applied to the camera target's x. Used so agents
  // aren't hidden behind floating UI panels on the left of the screen.
  xBias: number;
}) {
  const { camera } = useThree();
  const desiredPos = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const lerpedTarget = useRef(new THREE.Vector3());

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // To make scene content appear shifted RIGHT of viewport centre, we
    // pan only the camera's lookAt target LEFT — the camera's projection
    // then puts the world origin to the right of centre. Shifting both
    // the camera position AND the target translates the orbit but
    // doesn't change apparent screen-space framing.
    if (isFocused && focusPosition) {
      // Hold-still framing on the focused tile. xBias pushes the tile
      // right of centre on screen so floating queue/detail panels
      // don't sit on top of it.
      desiredPos.current.set(focusPosition[0], 2.6, focusPosition[2] + 4.2);
      desiredTarget.current.set(focusPosition[0] - xBias, 0, focusPosition[2]);
    } else {
      // Slow drift orbit around fleet centre — ~85s per revolution.
      const angle = t * 0.012;
      const radius = sceneRadius * 2.4 + Math.sin(t * 0.04) * sceneRadius * 0.2;
      const height = sceneRadius * 1.0 + Math.sin(t * 0.03) * sceneRadius * 0.15;
      desiredPos.current.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
      desiredTarget.current.set(-xBias, 0, 0);
    }
    // Frame-rate-tolerant lerp. Faster lerp on focus transitions so the
    // dolly catches up quickly when you click a tile or hit Esc.
    const lerpStrength = isFocused ? 0.05 : 0.04;
    camera.position.lerp(desiredPos.current, lerpStrength);
    lerpedTarget.current.lerp(desiredTarget.current, lerpStrength);
    camera.lookAt(lerpedTarget.current);
  });
  return null;
}

function HexTile({
  session,
  position,
}: {
  session: SessionRow;
  position: [number, number, number];
}) {
  // Parent group that smoothly lerps to the agent's "current tile"
  // position. The agent floats over its most-recently-claimed tile,
  // hopping to the next as new files enter the cumulative diff.
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const ripplesRef = useRef<THREE.Mesh[]>([]);
  const selected = useCockpitStore((s) => s.selectedSessionId === session.cockpitSessionId);
  const someoneSelected = useCockpitStore((s) => s.selectedSessionId !== null);
  const setSelected = useCockpitStore((s) => s.setSelected);
  const setHovered = useCockpitStore((s) => s.setHovered);

  const colour = STATE_COLOURS[session.state] ?? '#5a6573';
  const needsDecision = session.state === 'needs-decision' || session.state === 'blocked';

  // Context-pressure height: ratio of cumulative input tokens to context window.
  // Min 0.2 (always visible), max 3.5 units. Maps to a vertical column whose
  // height grows as the agent fills its context. Vision: a tall tile = "this
  // agent is about to hit context limit, time to compact / hand off".
  const pressure = useMemo(() => {
    const tokens = session.cumulativeInputTokens ?? 0;
    const window = session.contextWindow ?? 200_000;
    if (window <= 0) return 0;
    return Math.min(1, tokens / window);
  }, [session.cumulativeInputTokens, session.contextWindow]);
  const tileHeight = TILE_HEIGHT + pressure * 3.2;

  // Staleness = no events in the last 30 min.
  const stale = useMemo(() => {
    if (!session.lastEventAt) return 1;
    const ageMs = Date.now() - Date.parse(session.lastEventAt);
    return Math.min(1, Math.max(0, ageMs / (1000 * 60 * 30)));
  }, [session.lastEventAt]);

  // Activity ripples: when lastEventAt changes, push a ripple that expands
  // outward over ~1.4s. We keep a fixed pool of 3 ripple slots and rotate
  // through them so React doesn't have to add/remove meshes.
  const lastSeenRef = useRef<string | null>(null);
  const ripplePoolRef = useRef<{ start: number; active: boolean }[]>([
    { start: 0, active: false },
    { start: 0, active: false },
    { start: 0, active: false },
  ]);
  const nextRippleSlot = useRef(0);
  if (session.lastEventAt && session.lastEventAt !== lastSeenRef.current) {
    lastSeenRef.current = session.lastEventAt;
    const slot = ripplePoolRef.current[nextRippleSlot.current];
    slot.start = performance.now();
    slot.active = true;
    nextRippleSlot.current = (nextRippleSlot.current + 1) % ripplePoolRef.current.length;
  }

  // Token velocity (tokens/second over the last 30s). Drives two non-rotating
  // motion signals: a vertical bob whose amplitude scales with velocity, and
  // a halo heartbeat whose pulse rate scales with velocity. Idle = barely
  // visible breath; hot = pronounced bob + fast bright pulse.
  const tokenHistoryRef = useRef<{ t: number; tokens: number }[]>([]);
  const tokenVelocity = useMemo(() => {
    const tokens = session.cumulativeInputTokens ?? 0;
    const now = Date.now();
    tokenHistoryRef.current.push({ t: now, tokens });
    while (tokenHistoryRef.current.length > 1 && now - tokenHistoryRef.current[0].t > 30_000) {
      tokenHistoryRef.current.shift();
    }
    if (tokenHistoryRef.current.length < 2) return 0;
    const oldest = tokenHistoryRef.current[0];
    const dt = (now - oldest.t) / 1000;
    if (dt <= 0) return 0;
    return Math.max(0, (tokens - oldest.tokens) / dt);
  }, [session.cumulativeInputTokens]);
  // 0 → 1 normalised intensity. 5_000 tok/s ≈ saturated.
  const velocityIntensity = Math.min(1, tokenVelocity / 5_000);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    // Smoothly lerp the parent group towards the agent's target tile.
    // ~10%/frame at 60fps → ~600ms to settle (matches the design feel
    // of "agent hops to the next file it touches"). When the agent
    // first appears, this snaps from origin.
    //
    // y is held at FLOAT_HEIGHT so the agent hovers over its tile
    // rather than standing on it.
    if (groupRef.current) {
      const g = groupRef.current.position;
      g.x += (position[0] - g.x) * 0.1;
      g.z += (position[2] - g.z) * 0.1;
      g.y += (FLOAT_HEIGHT - g.y) * 0.1;
    }
    // Vertical bob. Idle = barely-there 1.4Hz breath; busier = larger 2-3Hz
    // bob. Rate and amplitude both scale with token velocity. Per-tile phase
    // offset so the fleet doesn't bob in lockstep.
    const bobRate = 1.4 + velocityIntensity * 1.8;
    const bobAmp = 0.04 + velocityIntensity * 0.18;
    const bobOffset = Math.sin(t * bobRate + position[0] * 0.7 + position[2] * 0.5) * bobAmp;
    if (meshRef.current) {
      // Tower keeps its base size whether selected or not — the
      // float-height + camera dolly already call attention to the
      // selected agent, so a scale bump on top reads as oversized.
      meshRef.current.scale.set(1, 1, 1);
      const desiredY = tileHeight / 2 + bobOffset;
      meshRef.current.position.y += (desiredY - meshRef.current.position.y) * 0.25;
    }
    // Halo "heartbeat" — pulse rate scales with velocity. Idle: slow soft glow.
    // Hot: fast bright glow. Plus the existing freshness fade.
    if (haloRef.current) {
      const heartRate = 0.9 + velocityIntensity * 2.6;
      const heartbeat = 0.5 + 0.5 * Math.sin(t * heartRate * Math.PI);
      const fresh = 1 - stale;
      const baseScale = TILE_RADIUS * 1.7 * (1 + heartbeat * 0.25) * (1 + fresh * 0.4);
      haloRef.current.scale.set(baseScale, baseScale, 1);
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      const intensityFloor = 0.08;
      const intensityPeak = 0.15 + velocityIntensity * 0.55 + (needsDecision ? 0.25 : 0);
      mat.opacity =
        (intensityFloor + (intensityPeak - intensityFloor) * heartbeat) * (0.5 + 0.5 * fresh);
    }
    // Ripple animation: each active slot expands its ring + fades over 1.4s.
    const now = performance.now();
    for (let i = 0; i < ripplePoolRef.current.length; i++) {
      const slot = ripplePoolRef.current[i];
      const mesh = ripplesRef.current[i];
      if (!mesh) continue;
      if (!slot.active) {
        mesh.visible = false;
        continue;
      }
      const elapsed = (now - slot.start) / 1400; // 0..1
      if (elapsed >= 1) {
        slot.active = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const r = TILE_RADIUS * (0.7 + elapsed * 5);
      mesh.scale.set(r, r, 1);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 * (1 - elapsed);
    }
  });

  // Dim other tiles when one is selected — strategic-zoom focus.
  const dimmed = someoneSelected && !selected;
  const baseOpacity = 0.55 + (1 - stale) * 0.45;
  const opacity = dimmed ? baseOpacity * 0.3 : baseOpacity;
  const emissiveBoost = needsDecision ? 2.4 : selected ? 1.6 : 1.1 + (1 - stale) * 0.6;

  return (
    <group ref={groupRef}>
      {/* Vertical column whose height = context pressure. Geometry args
          recreate when tileHeight changes — fine, they're cheap. */}
      <mesh
        ref={meshRef}
        rotation={[0, Math.PI / 6, 0]}
        position={[0, tileHeight / 2, 0]}
        castShadow
        receiveShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(session.cockpitSessionId);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = '';
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelected(session.cockpitSessionId);
        }}
      >
        <cylinderGeometry args={[TILE_RADIUS, TILE_RADIUS, tileHeight, 6]} />
        <meshStandardMaterial
          color={colour}
          emissive={colour}
          emissiveIntensity={emissiveBoost}
          transparent
          opacity={opacity}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>
      {/* Floor halo — only rendered when this agent actually needs
          attention. Calm-technology: idle agents don't pulse their floor
          halo, only the ones blocking on a decision do. */}
      {needsDecision && (
        <mesh ref={haloRef} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1, 24]} />
          <meshBasicMaterial color={colour} transparent opacity={0.12} />
        </mesh>
      )}
      {/* Laughing-Man identity ring — agent identifier wrapped flat
          around the hex base, rotating slowly. */}
      <IdentityRing
        identity={(session.agentLabel ?? session.cockpitSessionId.slice(-6)).toUpperCase()}
        colour={colour}
        dim={dimmed}
      />
      {/* Activity ripples — three pooled rings that expand+fade on event */}
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) ripplesRef.current[i] = el;
          }}
          position={[0, 0.01, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <ringGeometry args={[0.92, 1.0, 32]} />
          <meshBasicMaterial color={colour} transparent opacity={0.55} />
        </mesh>
      ))}
      {/* Pressure indicator on tall tiles: faint warning ring at top when ≥70% */}
      {pressure >= 0.7 && (
        <mesh position={[0, tileHeight + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[TILE_RADIUS * 0.8, TILE_RADIUS * 1.05, 32]} />
          <meshBasicMaterial
            color={pressure >= 0.9 ? '#ef4444' : '#f59e0b'}
            transparent
            opacity={0.7}
          />
        </mesh>
      )}
    </group>
  );
}

// Laughing-Man-style identity ring: the agent's identifier printed flat
// on the territory floor, marching slowly around a fixed band of two
// guard rings + dark fill. The text lies in the floor plane (XZ) — if
// you looked straight down it would be flat to the screen; from the
// locked oblique cockpit camera, the back of the ring is foreshortened.
//
// Implementation: per-glyph placement around the ring, each glyph
// rotated to lie tangent to its position. Ticker animation = rotating
// the parent group around the floor normal. troika's curveRadius is
// NOT used — it builds a vertical curved ribbon, which doesn't lay
// flat on a floor.
const IDENTITY_RING_RADIUS = 0.92; // just outside TILE_RADIUS = 0.55
const IDENTITY_RING_FONT = 0.16;
// Approx character width at the chosen fontSize, used to space glyphs
// evenly around the circumference.
const IDENTITY_RING_CHAR_W = 0.135;
const IDENTITY_RING_PERIOD_S = 22; // seconds per revolution

function IdentityRing({
  identity,
  colour,
  dim,
}: {
  identity: string;
  colour: string;
  dim: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Build a string that fills the circumference. Goal: tile a whole
  // number of identifier repetitions so the loop never has a "seam"
  // where the truncated tail meets the head and reads as gibberish.
  // We pick the integer number of repeats whose total natural length
  // is closest to the circumference, then slightly stretch (or compress)
  // glyph spacing so the chosen repetitions fill exactly.
  //
  // Short identifiers get forced to ≥2 repeats so the ring doesn't
  // feel sparse (one short word with a big bullet gap reads worse than
  // two of them stacked).
  const { glyphs, charSpan } = useMemo(() => {
    const circumference = 2 * Math.PI * IDENTITY_RING_RADIUS;
    const unit = `${identity} · `;
    const unitLen = unit.length;
    const naturalRepeats = circumference / (unitLen * IDENTITY_RING_CHAR_W);
    let repeats = Math.max(2, Math.round(naturalRepeats));
    // Don't let stretch/squash exceed ±35% of natural — beyond that
    // the text starts to look broken. If we're outside the band, snap
    // to the nearest integer that keeps us in range.
    const stretch = naturalRepeats / repeats;
    if (stretch < 0.65) repeats += 1;
    else if (stretch > 1.35) repeats = Math.max(2, repeats - 1);
    const total = unit.repeat(repeats);
    const span = circumference / total.length; // per-glyph arc length
    return { glyphs: total.split(''), charSpan: span };
  }, [identity]);

  // Slow continuous rotation around the floor normal. The whole glyph
  // ring orbits as one rigid body — characters travel around the static
  // band of guard rings + dark fill, like a stock ticker bent into a
  // circle. Direction is chosen so glyphs roll *into* the reader's view
  // along the natural left-to-right reading order: at the top of the
  // ring (camera-facing side) the text passes by reading-direction-up.
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += (delta * Math.PI * 2) / IDENTITY_RING_PERIOD_S;
  });

  // The static decoration (band fill + two guard rings) lives outside
  // groupRef so it doesn't move with the ticker.
  const bandInner = IDENTITY_RING_RADIUS - IDENTITY_RING_FONT * 0.9;
  const bandOuter = IDENTITY_RING_RADIUS + IDENTITY_RING_FONT * 0.9;
  const guardWidth = 0.008;
  const yText = 0.014;

  return (
    <group position={[0, 0, 0]}>
      {/* Dark fill plate — slightly lighter than the floor so the
          glyphs read against contrast even when the floor is dark. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <ringGeometry args={[bandInner, bandOuter, 96]} />
        <meshBasicMaterial
          color="#0b0f14"
          transparent
          opacity={dim ? 0.55 : 0.92}
          depthWrite={false}
        />
      </mesh>
      {/* Inner guard ring. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]}>
        <ringGeometry args={[bandInner - guardWidth, bandInner, 96]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={dim ? 0.3 : 0.85}
          depthWrite={false}
        />
      </mesh>
      {/* Outer guard ring. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]}>
        <ringGeometry args={[bandOuter, bandOuter + guardWidth, 96]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={dim ? 0.3 : 0.85}
          depthWrite={false}
        />
      </mesh>
      {/* Glyph carousel — per-character flat placement around the ring,
          ticking via a rotation on the parent group. Every glyph lies
          face-up on the floor (rotation X = -π/2), with an additional
          rotation around its own Y axis so the baseline is tangent to
          the ring (text reads along the band, not pointing radially). */}
      <group ref={groupRef}>
        {glyphs.map((ch, i) => {
          // Spacing is derived so an integer number of identifier
          // repetitions tiles the ring exactly — no seam where the
          // truncated tail meets the head.
          const theta = (i * charSpan) / IDENTITY_RING_RADIUS;
          const x = Math.cos(theta) * IDENTITY_RING_RADIUS;
          const z = Math.sin(theta) * IDENTITY_RING_RADIUS;
          // Two rotations on the glyph mesh:
          //   1. -π/2 around X lays it flat on the floor.
          //   2. -theta around Z (the glyph's local up after step 1)
          //      orients its baseline tangent to the ring.
          // Combined as Euler XYZ ordering: (-π/2, 0, -theta).
          return (
            <Text
              key={i}
              position={[x, yText, z]}
              rotation={[-Math.PI / 2, 0, -theta - Math.PI / 2]}
              fontSize={IDENTITY_RING_FONT}
              color={colour}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.004}
              outlineColor="#000"
              fillOpacity={dim ? 0.3 : 0.95}
            >
              {ch}
            </Text>
          );
        })}
      </group>
    </group>
  );
}

function TerritoryRing({
  territory,
  claimedColours,
  cellToFile,
}: {
  territory: Territory;
  // Cell-key → state colour for cells claimed by this island's
  // sessions. Computed once at the parent so the allocation is shared
  // with the agent renderer.
  claimedColours: Map<string, string>;
  // Cell-key → which file the cell represents, if claimed. Empty cells
  // (no entry) trigger the spawn flow on click; claimed cells open the
  // tile-detail panel.
  cellToFile: Map<string, { cockpitSessionId: string; filePath: string }>;
}) {
  const accent = territory.decisionCount > 0 ? '#f59e0b' : '#0f2c40';
  const openSpawnModal = useCockpitStore((s) => s.openSpawnModal);
  const setSelectedTile = useCockpitStore((s) => s.setSelectedTile);
  // Hover dim used to be wired to a territory-level circle; now the
  // tiles themselves are the affordance, so just always-bright. Kept
  // as a constant so material params don't have to be conditional.
  const hovered = false;

  // Cell positions in island-local world coords PLUS a deterministic
  // depth scale per cell (terrain texture). Hashing on (q, r) keeps
  // the same cell at the same depth across re-renders. The hash is a
  // small wave function with stable output in [0, 1).
  const cellWorldPositions = useMemo<
    { x: number; z: number; depth: number; coord: AxialCoord }[]
  >(() => {
    const island = {
      cockpitProjectId: territory.cockpitProjectId,
      name: territory.name,
      worldCentre: [0, 0] as [number, number],
      axialCentre: { q: 0, r: 0 },
      worldRadius: territory.radius,
    };
    return islandCells(island).map((c) => {
      const [cx, , cz] = localAxialToWorld(island, c);
      // Cheap hash → [0, 1). Two sin terms give just enough variation
      // that nearby cells aren't identical, while staying smooth.
      const h = Math.abs(Math.sin(c.q * 12.9898 + c.r * 78.233) * 43758.5453);
      const u = h - Math.floor(h);
      // Depth scale in [1, 5] — base geometry depth ~0.14, so cells
      // range from ~0.14 to ~0.70 in world height. The current depth
      // is the floor; tall cells rise from it like rocky outcrops.
      const depth = 1 + u * 4;
      return { x: cx, z: cz, depth, coord: c };
    });
  }, [territory.cockpitProjectId, territory.name, territory.radius]);

  // Build a merged line-segments geometry for every cell's outline.
  // One BufferGeometry covers all 127 cells × 6 edges so the GPU does
  // ~one drawcall instead of hundreds.
  // Wireframe of every tile's full 3D prism: top hexagon + bottom
  // hexagon + 6 vertical edges per cell. Each cell's top sits at its
  // own scaled depth so the wireframe matches the per-cell terrain
  // height. y=0 is the floor where the prism's bottom sits; the
  // base geometry's depth is BASE_TILE_DEPTH, scaled by cell.depth.
  const islandLineGeo = useMemo(() => {
    const corners = hexCorners();
    const positions: number[] = [];
    const yBottom = 0;
    for (const cell of cellWorldPositions) {
      const yTop = cell.depth * BASE_TILE_DEPTH;
      for (let i = 0; i < 6; i++) {
        const [x1, z1] = corners[i];
        const [x2, z2] = corners[(i + 1) % 6];
        // Bottom hex edge.
        positions.push(cell.x + x1, yBottom, cell.z + z1, cell.x + x2, yBottom, cell.z + z2);
        // Top hex edge.
        positions.push(cell.x + x1, yTop, cell.z + z1, cell.x + x2, yTop, cell.z + z2);
        // Vertical edge from this corner up to the matching top corner.
        positions.push(cell.x + x1, yBottom, cell.z + z1, cell.x + x1, yTop, cell.z + z1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [cellWorldPositions]);

  // Build the glass-tile geometry from the SAME corners as the
  // wireframe outline so the two layers can never drift out of
  // alignment. We use a 2D Shape extruded along Y, instanced across
  // all cells. One drawcall per island, alignment guaranteed.
  const tileGeo = useMemo(() => {
    const corners = hexCorners();
    const shape = new THREE.Shape();
    // Shape is in XY plane locally; we'll lay it flat in XZ by
    // rotating the geometry once after extrude.
    shape.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) shape.lineTo(corners[i][0], corners[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: BASE_TILE_DEPTH,
      bevelEnabled: false,
      curveSegments: 1,
    });
    // ExtrudeGeometry extrudes along +Z in shape-local space, with
    // the shape lying in XY. Rotate the geometry so the shape lies
    // in the world XZ floor and the extrusion goes along world Y.
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const tileMeshRef = useRef<THREE.InstancedMesh>(null);
  // Per-tile hover state. The ref is read inside useFrame for the
  // smooth highlight animation; the state mirrors it so the "+ SPAWN"
  // text appears at the right cell when an unclaimed tile is hovered.
  // We only highlight (brighten colour); we don't lift the tile —
  // moving the geometry under the pointer causes the cursor to drop
  // out of the hit region and toggle hover off.
  const hoveredIdxRef = useRef<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  // Tracks the previous frame's hovered idx so the unhover transition
  // (current → base) can use the fast hover lerp rather than the
  // slow ownership lerp.
  const prevHoveredIdxRef = useRef<number | null>(null);
  useEffect(() => {
    const mesh = tileMeshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    cellWorldPositions.forEach((cell, i) => {
      dummy.position.set(cell.x, 0, cell.z);
      dummy.rotation.set(0, 0, 0);
      // Per-cell terrain depth via Y scale. The base geometry has
      // depth 0.14; scaled by [0.7, 1.3] this gives ~0.10 to ~0.18
      // — terrain texture without the surface becoming jagged.
      dummy.scale.set(1, cell.depth, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Recompute the bounding sphere over all instances so r3f's
    // raycast early-out test (which uses the aggregate bounds) doesn't
    // miss everything when the matrices change. Without this, click +
    // hover events fall through to onPointerMissed.
    mesh.computeBoundingSphere();
  }, [cellWorldPositions]);

  // Per-instance colour, animated. We track a target colour per cell
  // and lerp each cell's *rendered* colour towards its target every
  // frame. When ownership of a cell changes (agent merges / land
  // redistributes), the colour fades from old → new over ~1.5s. We
  // also kick off a Y-scale bounce on cells whose target just
  // changed: the cell shrinks then grows back, candy-crush style.
  const targetColourRef = useRef<THREE.Color[]>([]);
  const currentColourRef = useRef<THREE.Color[]>([]);
  // Per-cell bounce state: { active, startMs }. Updated on target-
  // colour change; ticked in useFrame.
  const bouncesRef = useRef<{ active: boolean; startMs: number }[]>([]);

  useEffect(() => {
    const mesh = tileMeshRef.current;
    if (!mesh) return;
    const firstInit = currentColourRef.current.length !== cellWorldPositions.length;
    // Re-init refs when the cell count changes.
    if (firstInit) {
      currentColourRef.current = cellWorldPositions.map(() => new THREE.Color(accent));
      targetColourRef.current = cellWorldPositions.map(() => new THREE.Color(accent));
      bouncesRef.current = cellWorldPositions.map(() => ({ active: false, startMs: 0 }));
    }
    // Diff target colours; on change, kick a bounce.
    const tmp = new THREE.Color();
    cellWorldPositions.forEach((cell, i) => {
      const k = cellKey(cell.coord);
      const colourHex = claimedColours.get(k) ?? accent;
      tmp.set(colourHex);
      const tgt = targetColourRef.current[i];
      // Compare in r/g/b directly — equals() returns false on minor
      // float diffs we don't care about.
      const close =
        Math.abs(tgt.r - tmp.r) < 1e-3 &&
        Math.abs(tgt.g - tmp.g) < 1e-3 &&
        Math.abs(tgt.b - tmp.b) < 1e-3;
      if (!close) {
        tgt.copy(tmp);
        bouncesRef.current[i] = { active: true, startMs: performance.now() };
      }
    });
    // Seed instance colours on first init so cells render in the
    // right base colour from the start. Without this, the per-frame
    // loop only writes setColorAt when there's a delta, and the
    // default instance colour is white.
    if (firstInit) {
      cellWorldPositions.forEach((_, i) => {
        const cur = currentColourRef.current[i];
        if (cur) mesh.setColorAt(i, cur);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [cellWorldPositions, claimedColours, accent]);

  // Per-frame lerp of rendered colours toward target colours, plus
  // candy-crush Y-scale bounce on cells whose ownership just changed.
  // The hovered cell composes a brightness boost on top of its base
  // target colour so the highlight is purely chromatic — no lift, so
  // the cursor never drops off the tile.
  useFrame(() => {
    const mesh = tileMeshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const now = performance.now();
    // Slow base-colour transitions; fast hover snap.
    const COLOUR_LERP = 0.12;
    const HOVER_LERP = 0.3; // ~80ms to converge — feels instant.
    const BOUNCE_MS = 800;
    // Mix factor toward white for the hovered cell's display colour.
    // 0.55 produces a visibly bright tinted highlight without going
    // pure white (which would lose the tint identity entirely).
    const HOVER_WHITE_MIX = 0.55;
    let anyColourChange = false;
    let anyMatrixChange = false;
    const hoveredCellIdx = hoveredIdxRef.current;
    const tmp = new THREE.Color();
    cellWorldPositions.forEach((cell, i) => {
      const cur = currentColourRef.current[i];
      const tgt = targetColourRef.current[i];
      if (!cur || !tgt) return;
      // Display target: hovered → mix base toward white; otherwise
      // just the base.
      const isHover = i === hoveredCellIdx;
      if (isHover) {
        tmp.r = tgt.r + (1 - tgt.r) * HOVER_WHITE_MIX;
        tmp.g = tgt.g + (1 - tgt.g) * HOVER_WHITE_MIX;
        tmp.b = tgt.b + (1 - tgt.b) * HOVER_WHITE_MIX;
      } else {
        tmp.r = tgt.r;
        tmp.g = tgt.g;
        tmp.b = tgt.b;
      }
      const dr = tmp.r - cur.r;
      const dg = tmp.g - cur.g;
      const db = tmp.b - cur.b;
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 5e-4) {
        // Hover snap: if this cell is becoming or just stopped being
        // hovered, lerp fast. Otherwise (ownership flips, redistribute)
        // lerp slowly.
        const wasHover = i === prevHoveredIdxRef.current;
        const k = isHover || wasHover ? HOVER_LERP : COLOUR_LERP;
        cur.r += dr * k;
        cur.g += dg * k;
        cur.b += db * k;
        mesh.setColorAt(i, cur);
        anyColourChange = true;
      }
      // Bounce: scale-Y dips to 0.5 then back to 1.0 over BOUNCE_MS.
      const bounce = bouncesRef.current[i];
      if (bounce.active) {
        const t = (now - bounce.startMs) / BOUNCE_MS;
        if (t >= 1) {
          bounce.active = false;
          dummy.position.set(cell.x, 0, cell.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, cell.depth, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          anyMatrixChange = true;
        } else {
          const dip = 0.4 + 0.6 * Math.abs(Math.cos(t * Math.PI));
          dummy.position.set(cell.x, 0, cell.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, cell.depth * dip, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          anyMatrixChange = true;
        }
      }
    });
    if (anyColourChange && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (anyMatrixChange) mesh.instanceMatrix.needsUpdate = true;
    // Commit the hover idx for next frame's wasHover check.
    prevHoveredIdxRef.current = hoveredCellIdx;
  });

  return (
    <group position={[territory.centre[0], 0, territory.centre[1]]}>
      {/* Glass tile bed. Low translucent hex prisms — the terrain reads
          as cut glass rather than a wireframe. instancedMesh keeps the
          whole island to one drawcall regardless of cell count. */}
      <instancedMesh
        ref={tileMeshRef}
        args={[undefined, undefined, cellWorldPositions.length]}
        position={[0, -0.045, 0]}
        castShadow
        receiveShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerMove={(e) => {
          // Track the hovered hex so we can lift it + show the SPAWN
          // hint if it's unclaimed. Only fires when we're on a tile.
          const idx = (e as unknown as { instanceId?: number }).instanceId;
          if (idx == null) return;
          if (hoveredIdxRef.current !== idx) {
            hoveredIdxRef.current = idx;
            setHoveredIdx(idx);
          }
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
          hoveredIdxRef.current = null;
          setHoveredIdx(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          const idx = (e as unknown as { instanceId?: number }).instanceId;
          if (idx == null) return;
          const cell = cellWorldPositions[idx];
          if (!cell) return;
          const k = cellKey(cell.coord);
          const hit = cellToFile.get(k);
          if (hit) {
            // Claimed cell → open the file's diff in TileDetail.
            setSelectedTile(hit);
          } else {
            // Empty terrain → opens the project-scoped scoping flow
            // (same affordance the territory circle used to carry).
            // Empty hex inside an existing island → spawn an agent
            // into that project. Modal opens preselected.
            openSpawnModal({ projectId: territory.cockpitProjectId });
          }
        }}
      >
        <primitive object={tileGeo} attach="geometry" />
        {/* meshBasicMaterial: unlit. We deliberately want per-instance
            colour to render exactly as set so the hover highlight and
            ownership colours land on screen as authored — lighting was
            modulating instance colour into a washed-out grey. Tiles
            still cast shadows on the floor; they don't receive
            shadows on themselves, which is fine — the wireframe
            overlay carries depth perception either way. */}
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.95}
          depthWrite
        />
      </instancedMesh>
      {/* Crisp wireframe over the glass — keeps the hex grid legible
          even when the tiles' translucency dims. */}
      {/* Match the instancedMesh's offset so wireframe top/bottom
          align with the actual prism faces. */}
      <lineSegments geometry={islandLineGeo} position={[0, -0.045, 0]}>
        {/* Edge colour is decoupled from the tile fill so the wireframe
            stays legible against the (deliberately darker) tile base.
            Decision-active islands keep using the warn-amber accent so
            the edges echo the urgency the fill already shows. */}
        <lineBasicMaterial
          color={territory.decisionCount > 0 ? '#f59e0b' : '#3a7bb0'}
          transparent
          opacity={0.95}
          linewidth={2}
        />
      </lineSegments>
      {/* Hover hint: "+ SPAWN" floats above the hovered hex when it's
          empty terrain. Claimed tiles open the diff panel on click and
          don't need this hint. */}
      {hoveredIdx !== null &&
        cellWorldPositions[hoveredIdx] &&
        !cellToFile.has(cellKey(cellWorldPositions[hoveredIdx].coord)) && (
          <Billboard
            position={[
              cellWorldPositions[hoveredIdx].x,
              // Float above the tallest possible tile (5 × BASE) plus
              // a clear gap so the text never intersects the cell.
              5 * BASE_TILE_DEPTH + 0.45,
              cellWorldPositions[hoveredIdx].z,
            ]}
          >
            <Text
              fontSize={0.22}
              color="#7dd3fc"
              anchorX="center"
              anchorY="middle"
              letterSpacing={0.25}
              outlineWidth={0.01}
              outlineColor="#000"
            >
              + SPAWN
            </Text>
          </Billboard>
        )}
      {/* Project label, floating above the territory */}
      <Text
        position={[0, 0.05, -territory.radius - 0.4]}
        rotation={[-Math.PI / 2.3, 0, 0]}
        fontSize={0.4}
        color="#7dd3fc"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.3}
        outlineWidth={0.01}
        outlineColor="#000"
      >
        {territory.name.toUpperCase()}
      </Text>
      {/* Live-count readout under the label */}
      <Text
        position={[0, 0.05, -territory.radius - 0.85]}
        rotation={[-Math.PI / 2.3, 0, 0]}
        fontSize={0.18}
        color="#5a6573"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.2}
      >
        {`${territory.liveCount} LIVE${territory.decisionCount ? ` · ${territory.decisionCount} BLOCKED` : ''}`}
      </Text>
    </group>
  );
}

// Tron-style horizon. A giant inverted cylinder around the camera
// painted with a vertical gradient (dark above, cyan-tinted toward the
// horizon line) plus a bright thin emissive ring at floor level. The
// gradient sits in shader land — cheap, parametric, no textures.
function HorizonSky({ sceneRadius }: { sceneRadius: number }) {
  // Sky cylinder dims: comfortably outside the camera's far drift
  // (camera distance ≈ sceneRadius × 2.4) so it never clips. Tall
  // enough that the camera doesn't see the top cap edge.
  const skyRadius = sceneRadius * 6;
  const skyHeight = sceneRadius * 8;

  // Procedural gradient material. y0 = horizon (0). Above horizon →
  // top colour. Below horizon → ground tint (mostly hidden by floor).
  const skyMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color('#03050a') }, // deep ink
        // Match the torus colour so the gradient peak meets the
        // horizon ring brightness — without this match, the gradient
        // reads as a dark band where it transitions from torus-bright
        // to mid-horizonColor.
        horizonColor: { value: new THREE.Color('#5fc8ff') },
        horizonY: { value: 0 },
        // Smooths how quickly the cyan band falls off above the horizon.
        // Larger = a wider glow band fading up.
        bandHeight: { value: sceneRadius * 1.5 },
      },
      vertexShader: `
        varying float vWorldY;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldY = worldPosition.y;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform float horizonY;
        uniform float bandHeight;
        varying float vWorldY;
        void main() {
          float h = vWorldY - horizonY;
          // Discard fragments below the horizon. The hex floor + the
          // black canvas background carry that region — anything else
          // bleeds through the gridded tiles.
          if (h < 0.0) discard;
          // Above horizon: the gradient compresses heavily near the
          // horizon line in screen space (cylinder faces grazing the
          // camera). Using pow(t, 0.35) front-loads the cyan band so
          // it stays visible over a meaningful slice of pixels above
          // the line, instead of collapsing to a sub-pixel sliver.
          float bandT = clamp(h / bandHeight, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(bandT, 0.35));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }, [sceneRadius]);

  // Bright thin horizon ring. Sits exactly at horizon Y, additive
  // blended so it punches through any underlying gradient. Made of a
  // thin torus tilted to lay flat — easier than a flat ring because
  // it has volume the camera can graze.
  // Ring radius = skyRadius exactly so it lands precisely where the
  // cylinder skybox's discard creates the visual horizon line. Any
  // smaller and the ring projects to a screen-Y row below the
  // horizon (the cylinder's bottom edge sits further out).
  const ringRadius = skyRadius;

  return (
    <group>
      <mesh>
        <cylinderGeometry args={[skyRadius, skyRadius, skyHeight, 64, 1, true]} />
        <primitive object={skyMaterial} attach="material" />
      </mesh>
      {/* Horizon glow line — thin emissive torus on the horizon plane.
          The bloom postprocess composer picks this up and gives it a
          soft halo for free. We don't render a separate halo torus
          because its underside reads as a dark band against the
          gradient sky just above the horizon. */}

      {/* Flat ring lying on the horizon plane. ringRadius matches the
          skybox cylinder's outer radius so the ring lands where the
          cylinder's discard creates the visual horizon. RingGeometry
          gives a thin annulus with zero Y thickness — no torus tube
          to silhouette against the sky. The ring is wider in world
          units now (±0.5) because at this distance from the camera
          (~6×sceneRadius) it would otherwise project to sub-pixel. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[ringRadius - 0.5, ringRadius + 0.5, 256]} />
        <meshBasicMaterial color="#5fc8ff" transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// Hex-grid floor — wireframe of every cell in a wide ring around the
// origin. Sits at y ≈ -0.06 so it tucks under the project islands.
// Single BufferGeometry so the GPU renders the whole floor in one
// drawcall regardless of how big we make it.
function HexFloor({ sceneRadius }: { sceneRadius: number }) {
  const geometry = useMemo(() => {
    // Pick a hex radius that comfortably exceeds the camera's far
    // drift so the grid never visibly ends. Camera distance is
    // ~sceneRadius × 2.4; the ringFill radius needs to cover that
    // plus the orbit's own swing.
    // Keep the floor visibly inside the horizon ring. The horizon
    // sits at ~sceneRadius × 5.7 in world units; the floor's *cell*
    // ringRadius needs to map to a smaller world extent. Each cell
    // step covers HEX_W in the q direction, so axial-radius N maps
    // to ~N × HEX_W world units. Capping at sceneRadius × 2 gives a
    // healthy gap before the horizon line so receding hex lines
    // don't cluster against it.
    const ringRadius = Math.max(20, Math.ceil((sceneRadius * 2) / HEX_W));
    const corners = hexCorners();
    const cells = ringFill({ q: 0, r: 0 }, ringRadius);
    const positions: number[] = [];
    for (const c of cells) {
      const [cx, , cz] = axialToWorld(c);
      // Distance fade — far cells get fewer edges drawn so the
      // horizon visibly dies down rather than crisp-cut. We do this
      // by skipping every other edge on cells past 70% of the radius.
      const radial = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(-c.q - c.r));
      const dim = radial > ringRadius * 0.7;
      for (let i = 0; i < 6; i++) {
        if (dim && i % 2 === 0) continue;
        const [x1, z1] = corners[i];
        const [x2, z2] = corners[(i + 1) % 6];
        positions.push(cx + x1, 0, cz + z1, cx + x2, 0, cz + z2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [sceneRadius]);

  return (
    <lineSegments geometry={geometry} position={[0, -0.06, 0]}>
      <lineBasicMaterial color="#163048" transparent opacity={0.45} />
    </lineSegments>
  );
}

export function PortfolioMap({
  sessions,
  xBias = 0,
}: {
  sessions: SessionRow[];
  // Shifts the camera target right by N world units when floating
  // panels (queue, detail) are present, so agents stay clear of them.
  // 0 = centred; positive = pushes territories visually right.
  xBias?: number;
}) {
  const territories = useMemo(() => buildTerritories(sessions), [sessions]);
  const selectedSessionId = useCockpitStore((s) => s.selectedSessionId);

  // Territory intel — one entry per session with worktree state.
  // The canvas uses .changedFiles.length per session as the allocator's
  // tile count. We backfill on mount + the live stream (useLiveStream)
  // invalidates this query when the poller flags a real change.
  const territoryQ = useQuery({
    queryKey: ['territory'],
    queryFn: () => api.listTerritory(),
    refetchInterval: 30_000,
  });
  const intelBySession = useMemo(() => {
    const m = new Map<string, SessionIntel>();
    for (const t of territoryQ.data?.territories ?? []) m.set(t.cockpitSessionId, t);
    return m;
  }, [territoryQ.data]);

  // Track previous claim ownership across renders so we can detect
  // "this cell was claimed by a now-departed agent" and redistribute
  // it to the closest surviving neighbour. Survives across renders;
  // updated at the bottom of the allocations memo.
  const prevClaimsRef = useRef<
    Map<string, Map<string, { sessionId: string; cells: AxialCoord[] }>>
  >(new Map());

  // Allocate territory cells per-island, then collect per-session
  // results for both the island renderer (claimed cell colours) and
  // the agent renderer (current-tile world position to float over).
  // Includes land redistribution: cells freed by a merging/departing
  // agent are reassigned to the closest surviving neighbour.
  const allocations = useMemo(() => {
    const byProject = new Map<string, AllocatorResult>();
    const claimedByProject = new Map<string, Map<string, string>>();
    const currentTileBySession = new Map<string, [number, number, number]>();
    // cell key → { sessionId, filePath } so a click on a terrain tile
    // can resolve to the file it represents.
    const cellToFileByProject = new Map<
      string,
      Map<string, { cockpitSessionId: string; filePath: string }>
    >();
    const nextPrevClaims = new Map<
      string,
      Map<string, { sessionId: string; cells: AxialCoord[] }>
    >();

    for (const t of territories) {
      const island = {
        cockpitProjectId: t.cockpitProjectId,
        name: t.name,
        worldCentre: t.centre as [number, number],
        axialCentre: { q: 0, r: 0 },
        worldRadius: t.radius,
      };
      const cells = islandCells(island);
      const live = t.sessions.filter(
        (s) => !['stopped', 'merged', 'stale-zombie'].includes(s.state),
      );
      const sessionsForAllocator = live.map((s) => ({
        id: s.cockpitSessionId,
        want: intelBySession.get(s.cockpitSessionId)?.changedFiles.length ?? 0,
      }));
      const result = allocate({
        islandCells: cells,
        islandCentre: island.axialCentre,
        sessions: sessionsForAllocator,
      });
      byProject.set(t.cockpitProjectId, result);

      // Build the live colour map + cell→file mapping for this project.
      const claimedColours = new Map<string, string>();
      const survivorClaims = new Map<string, AxialCoord[]>();
      const cellToFile = new Map<
        string,
        { cockpitSessionId: string; filePath: string }
      >();
      for (const session of live) {
        const claims = result.claims.get(session.cockpitSessionId);
        if (!claims) continue;
        const colour = STATE_COLOURS[session.state] ?? '#5a6573';
        // Zip claims[i] ↔ changedFiles[i]. Allocator's claim order is
        // BFS frontier; git's diff order is alphabetical-ish. Both
        // are stable across renders for stable inputs.
        const intel = intelBySession.get(session.cockpitSessionId);
        const files = intel?.changedFiles ?? [];
        claims.forEach((c, idx) => {
          const k = cellKey(c);
          claimedColours.set(k, colour);
          const file = files[idx];
          if (file) {
            cellToFile.set(k, {
              cockpitSessionId: session.cockpitSessionId,
              filePath: file.path,
            });
          }
        });
        survivorClaims.set(session.cockpitSessionId, claims);
        const currentCell = claims[claims.length - 1] ?? result.seeds.get(session.cockpitSessionId);
        if (currentCell) {
          const [lx, , lz] = axialToWorld(currentCell);
          currentTileBySession.set(session.cockpitSessionId, [
            t.centre[0] + lx,
            0,
            t.centre[1] + lz,
          ]);
        }
      }

      // Redistribution: any cell that was claimed in the previous
      // render and isn't claimed by *anyone* now → freed. Hand each
      // freed cell to the closest surviving agent.
      const prevForProject = prevClaimsRef.current.get(t.cockpitProjectId);
      if (prevForProject && live.length > 0) {
        const prevByAgent = new Map<string, AxialCoord[]>();
        for (const [sid, { cells }] of prevForProject) prevByAgent.set(sid, cells);
        const freed = freedCells(prevByAgent, survivorClaims);
        if (freed.length > 0) {
          const winners = redistribute({ freed, survivors: survivorClaims });
          for (const [k, sessionId] of winners) {
            const session = live.find((s) => s.cockpitSessionId === sessionId);
            if (!session) continue;
            const colour = STATE_COLOURS[session.state] ?? '#5a6573';
            claimedColours.set(k, colour);
          }
        }
      }

      claimedByProject.set(t.cockpitProjectId, claimedColours);
      cellToFileByProject.set(t.cockpitProjectId, cellToFile);

      // Persist this frame's claims for next render's diff. Combine
      // the live result + any redistributed cells under their winners.
      const persisted = new Map<string, { sessionId: string; cells: AxialCoord[] }>();
      for (const session of live) {
        const claims = result.claims.get(session.cockpitSessionId) ?? [];
        persisted.set(session.cockpitSessionId, {
          sessionId: session.cockpitSessionId,
          cells: claims.slice(),
        });
      }
      nextPrevClaims.set(t.cockpitProjectId, persisted);
    }

    // Commit the new prev-claims after the render.
    prevClaimsRef.current = nextPrevClaims;

    return { byProject, claimedByProject, currentTileBySession, cellToFileByProject };
  }, [territories, intelBySession]);

  // Camera framed to encompass all territories. Compute the bounding circle
  // of all territory centres and set distance so the FOV covers it with margin.
  const sceneRadius = useMemo(() => {
    if (territories.length === 0) return 6;
    let max = 0;
    for (const t of territories) {
      const d = Math.sqrt(t.centre[0] ** 2 + t.centre[1] ** 2) + t.radius;
      if (d > max) max = d;
    }
    return Math.max(max, 6);
  }, [territories]);
  const cameraDistance = sceneRadius * 2.4;
  const cameraHeight = sceneRadius * 1.0;

  // Compute the world position of the selected agent's current tile,
  // if any. Strategic-zoom dolly target.
  const focusPosition = useMemo<[number, number, number] | null>(() => {
    if (!selectedSessionId) return null;
    return allocations.currentTileBySession.get(selectedSessionId) ?? null;
  }, [selectedSessionId, allocations]);

  const isFocused = !!focusPosition;
  const openSpawnFromCanvas = useCockpitStore((s) => s.openSpawnModal);
  const setSelected = useCockpitStore((s) => s.setSelected);

  return (
    <Canvas
      camera={{ position: [0, cameraHeight, cameraDistance], fov: 36 }}
      dpr={[1, 2]}
      shadows
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      onPointerMissed={() => {
        // Empty-canvas click. If a session is selected, deselect; otherwise
        // open the add-project modal (the only thing in empty space is "no
        // project yet — let me add one").
        if (selectedSessionId) {
          setSelected(null);
        } else {
          // Empty canvas (outside any island) → unified modal in
          // "new project" mode. Operator can also flip to existing.
          openSpawnFromCanvas({ mode: 'new' });
        }
      }}
    >
      <color attach="background" args={['#03050a']} />

      {/* Tron horizon: gradient skybox + glowing horizon ring. Replaces
          the previous fog wash; the ring gives the world a definitive
          ground plane instead of fading into pure black. */}
      <HorizonSky sceneRadius={sceneRadius} />

      {/* Cold-blue ambient + warmer rim light. The directional light is
          the shadow caster — sized to cover the whole scene so shadow
          edges stay crisp at any zoom. */}
      <ambientLight intensity={0.25} color="#5a8fbf" />
      <directionalLight
        position={[8, 14, 10]}
        intensity={0.7}
        color="#aab7d0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-camera-left={-sceneRadius * 3}
        shadow-camera-right={sceneRadius * 3}
        shadow-camera-top={sceneRadius * 3}
        shadow-camera-bottom={-sceneRadius * 3}
        shadow-bias={-0.0005}
      />
      <pointLight position={[-12, 4, -8]} intensity={0.35} color="#3a7bd5" />

      {/* Hex-grid floor — replaces the square gridHelpers. Lines up
          exactly with the tile islands so the eye reads them as
          contiguous terrain. Falls off in opacity from the centre so
          the horizon doesn't over-render. */}
      <HexFloor sceneRadius={sceneRadius} />
      {/* Shadow-receiver plane. shadowMaterial renders only where the
          shadow map indicates occlusion. Plane is kept *inside* the
          directional light's shadow-camera frustum (±sceneRadius × 3)
          so its edges aren't sampled outside the shadow data — that
          edge coincided with the horizon line in screen space and
          read as a dark band parallel to the horizon ring. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.06, 0]}
        receiveShadow
      >
        <planeGeometry args={[sceneRadius * 4, sceneRadius * 4]} />
        <shadowMaterial transparent opacity={0.45} />
      </mesh>
      {/* Opaque ground disc that extends out to the horizon ring so
          there's no gap of canvas background between the floor and
          the horizon line. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
        <circleGeometry args={[sceneRadius * 6, 64]} />
        <meshBasicMaterial color="#03050a" />
      </mesh>

      {territories.map((t) => (
        <TerritoryRing
          key={t.cockpitProjectId}
          territory={t}
          claimedColours={allocations.claimedByProject.get(t.cockpitProjectId) ?? new Map()}
          cellToFile={allocations.cellToFileByProject.get(t.cockpitProjectId) ?? new Map()}
        />
      ))}

      {territories.flatMap((t) =>
        t.sessions.map((s, i) => {
          // Float the agent over its current (most-recently-claimed)
          // tile. Sessions without intel yet fall back to the legacy
          // perimeter slot so they're still visible.
          const here = allocations.currentTileBySession.get(s.cockpitSessionId);
          const pos = here ?? tileSlot(i, t.sessions.length, t);
          return <HexTile key={s.cockpitSessionId} session={s} position={pos} />;
        }),
      )}

      {/* Auto-orbit dolly: drifts around the fleet centre when nothing is
          selected; tighter orbit around the focused tile when one is. The
          orbit IS the camera — no MapControls (vision pattern: continuous
          motion, the operator never stops to manually re-frame). */}
      <CameraDolly
        sceneRadius={sceneRadius}
        focusPosition={focusPosition}
        isFocused={isFocused}
        xBias={xBias}
      />

      <EffectComposer>
        <Bloom intensity={1.4} luminanceThreshold={0.15} luminanceSmoothing={0.5} mipmapBlur />
        <Vignette
          eskil={false}
          offset={0.25}
          darkness={0.85}
          blendFunction={BlendFunction.NORMAL}
        />
      </EffectComposer>
    </Canvas>
  );
}
