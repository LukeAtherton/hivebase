import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import type { SessionRow } from '../lib/api';
import { useCockpitStore } from '../store/cockpitStore';

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

const TERRITORY_RADIUS = 4;
const TILE_RADIUS = 0.55;
const TILE_HEIGHT = 0.28;

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
  const n = projectIds.length;

  // Lay territories around a larger ring so they don't overlap. Single
  // territory = centred. Two = side by side. Three+ = polar layout.
  return projectIds.map((id, i) => {
    const sessionsForProject = byProject
      .get(id)!
      .slice()
      .sort((a, b) => {
        const sa = STATE_ORDER[a.state] ?? 99;
        const sb = STATE_ORDER[b.state] ?? 99;
        return sa - sb;
      });
    let cx: number;
    let cz: number;
    if (n === 1) {
      cx = 0;
      cz = 0;
    } else if (n === 2) {
      cx = i === 0 ? -TERRITORY_RADIUS * 1.4 : TERRITORY_RADIUS * 1.4;
      cz = 0;
    } else {
      const ringRadius = TERRITORY_RADIUS * 1.6;
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      cx = Math.cos(angle) * ringRadius;
      cz = Math.sin(angle) * ringRadius;
    }
    return {
      cockpitProjectId: id,
      name: sessionsForProject[0]?.projectName ?? id.slice(-6),
      centre: [cx, cz],
      radius: TERRITORY_RADIUS,
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
}: {
  sceneRadius: number;
  focusPosition: [number, number, number] | null;
  isFocused: boolean;
}) {
  const { camera } = useThree();
  const desiredPos = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const lerpedTarget = useRef(new THREE.Vector3());

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (isFocused && focusPosition) {
      // Hold-still framing on the focused tile. Reading a transcript or
      // composing a reply doesn't tolerate camera drift — your eye loses
      // the agent it's trying to interact with. Camera fixed slightly above
      // and behind the tile, biased right so the detail panel doesn't cover
      // it.
      const xBias = 1.5;
      desiredPos.current.set(focusPosition[0] + xBias, 2.6, focusPosition[2] + 4.2);
      desiredTarget.current.set(focusPosition[0] + xBias, 0, focusPosition[2]);
    } else {
      // Slow drift orbit around fleet centre — ~85s per revolution. Radius
      // and height each drift with their own slow sine so the framing is
      // never identical twice. Cribbed from project-visualizer's
      // CircuitBoardScene AutoOrbitCamera.
      const angle = t * 0.012;
      const radius = sceneRadius * 2.4 + Math.sin(t * 0.04) * sceneRadius * 0.2;
      const height = sceneRadius * 1.0 + Math.sin(t * 0.03) * sceneRadius * 0.15;
      desiredPos.current.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
      desiredTarget.current.set(0, 0, 0);
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
    // Vertical bob. Idle = barely-there 1.4Hz breath; busier = larger 2-3Hz
    // bob. Rate and amplitude both scale with token velocity. Per-tile phase
    // offset so the fleet doesn't bob in lockstep.
    const bobRate = 1.4 + velocityIntensity * 1.8;
    const bobAmp = 0.04 + velocityIntensity * 0.18;
    const bobOffset = Math.sin(t * bobRate + position[0] * 0.7 + position[2] * 0.5) * bobAmp;
    if (meshRef.current) {
      const pulse = needsDecision
        ? 1 + Math.sin(t * 4) * 0.15
        : 1 + Math.sin(t * 1.4 + position[0]) * 0.025; // tiny idle sway
      const baseScale = selected ? 1.5 : 1.0;
      meshRef.current.scale.x = baseScale * pulse;
      meshRef.current.scale.z = baseScale * pulse;
      meshRef.current.scale.y = 1;
      // Lift selected tile a bit AND apply velocity bob
      const targetLift = selected ? 0.3 : 0;
      const desiredY = tileHeight / 2 + targetLift + bobOffset;
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
    <group position={position}>
      {/* Vertical column whose height = context pressure. Geometry args
          recreate when tileHeight changes — fine, they're cheap. */}
      <mesh
        ref={meshRef}
        rotation={[0, Math.PI / 6, 0]}
        position={[0, tileHeight / 2, 0]}
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
      {/* Floor halo — breathes, scales with freshness */}
      <mesh ref={haloRef} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color={colour} transparent opacity={0.12} />
      </mesh>
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
      {selected && (
        <Html distanceFactor={8} position={[0, tileHeight + 0.6, 0]} center>
          <div className="pointer-events-none whitespace-nowrap rounded border border-accent/60 bg-panel/95 px-2 py-1 text-[10px] uppercase tracking-wider text-text shadow-[0_0_12px_rgba(125,211,252,0.4)]">
            {session.agentLabel ?? session.cockpitSessionId.slice(-6)}
            <span className="ml-2 text-muted">{session.state}</span>
            <span className="ml-2 text-accent">{Math.round(pressure * 100)}%</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function TerritoryRing({ territory }: { territory: Territory }) {
  const accent = territory.decisionCount > 0 ? '#f59e0b' : '#1a4a6a';
  return (
    <group position={[territory.centre[0], 0, territory.centre[1]]}>
      {/* Outer ring — territory boundary */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[territory.radius - 0.04, territory.radius, 96]} />
        <meshBasicMaterial color={accent} transparent opacity={0.55} />
      </mesh>
      {/* Inner faint disc — territory floor wash */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[territory.radius - 0.06, 64]} />
        <meshBasicMaterial color={accent} transparent opacity={0.04} />
      </mesh>
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

export function PortfolioMap({ sessions }: { sessions: SessionRow[] }) {
  const territories = useMemo(() => buildTerritories(sessions), [sessions]);
  const selectedSessionId = useCockpitStore((s) => s.selectedSessionId);

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

  // Compute the world position of the selected tile, if any. Strategic-zoom
  // dolly target.
  const focusPosition = useMemo<[number, number, number] | null>(() => {
    if (!selectedSessionId) return null;
    for (const t of territories) {
      const idx = t.sessions.findIndex((s) => s.cockpitSessionId === selectedSessionId);
      if (idx >= 0) return tileSlot(idx, t.sessions.length, t);
    }
    return null;
  }, [selectedSessionId, territories]);

  const isFocused = !!focusPosition;

  return (
    <Canvas
      camera={{ position: [0, cameraHeight, cameraDistance], fov: 36 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#03050a']} />
      <fog attach="fog" args={['#03050a', cameraDistance * 0.7, cameraDistance * 2.0]} />

      {/* Cold-blue ambient + warmer rim light */}
      <ambientLight intensity={0.25} color="#5a8fbf" />
      <directionalLight position={[8, 14, 10]} intensity={0.45} color="#aab7d0" />
      <pointLight position={[-12, 4, -8]} intensity={0.35} color="#3a7bd5" />

      {/* Grid floor */}
      <gridHelper args={[80, 80, '#0e2540', '#0a1830']} position={[0, -0.06, 0]} />
      {/* Subtle inner grid emphasis */}
      <gridHelper args={[24, 24, '#1a3a5a', '#0e2540']} position={[0, -0.055, 0]} />

      {territories.map((t) => (
        <TerritoryRing key={t.cockpitProjectId} territory={t} />
      ))}

      {territories.flatMap((t) =>
        t.sessions.map((s, i) => (
          <HexTile
            key={s.cockpitSessionId}
            session={s}
            position={tileSlot(i, t.sessions.length, t)}
          />
        )),
      )}

      {/* Auto-orbit dolly: drifts around the fleet centre when nothing is
          selected; tighter orbit around the focused tile when one is. The
          orbit IS the camera — no MapControls (vision pattern: continuous
          motion, the operator never stops to manually re-frame). */}
      <CameraDolly sceneRadius={sceneRadius} focusPosition={focusPosition} isFocused={isFocused} />

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
