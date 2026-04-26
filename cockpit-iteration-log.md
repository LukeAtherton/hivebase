# Cockpit iteration log

3-hour autonomous iteration toward the Swarm vision (`~/Projects/kybernos/VISION.md`)
and the cockpit plan (`COCKPIT_PLAN.md`). Each cycle: vision recall → expose
gap with the multi-product fleet (tally, pulse, atlas) → pick most-jarring
issue → fix → typecheck/build → journal → commit if coherent.

Vision aesthetic anchors: Stellaris (outliner, situation log, territories),
Supreme Commander (strategic zoom, oblique camera), Airbus glass cockpit
(dark by default, master caution), NASA mission control (GO/NO-GO ceremony,
console roles), Tron / cyberpunk / Ender's Game (cold blue glow, depth, scale).

---

## Cycle 1 — assess vs vision

### Vision principles in head

- Dark cockpit by default; visual energy = abnormal.
- Decisions, not events. Top line glanceable.
- Situation log > notification feed.
- Decision ledger as canonical history.
- Per-capability autonomy.
- Grand-strategy framing (Stellaris/Supreme Commander), not StarCraft micro.
- Many isolated workstreams; supervision is the load-bearing relationship.
- Measure ourselves.

### Observed (via Chrome extension on localhost:4400)

- Accessibility tree describes the page as "a project management or task
  tracking interface". That is the failure: the cockpit is reading as a
  generic Vercel-style dashboard, not as the mission-control / cockpit
  surface the vision calls for.
- Top bar: plain text in muted grey ("0 decisions · 0 required · 6 live
  agents · fleet ok"). No instrument-panel feel.
- Portfolio map (1368×599 canvas in the top-left) renders an undifferentiated
  golden-spiral cloud of icosahedrons. No project grouping. No territory
  labels. Free-orbit camera, not strategic-zoom oblique.
- Outliner: small, plain. Sessions grouped under a project ID slug
  ("HVV7ARJR") — not under the project's actual name.
- Decision queue: empty most of the time, "fleet is quiet" placeholder.

### Gaps ranked

1. **Map has no territories.** Stars don't belong to any project. A fleet
   of 15 across 3 codebases reads as one cloud. Endsley's Comprehension
   layer fails.
2. **Aesthetic is "3D demo" not "cockpit display".** No bloom, no depth
   cues, no oblique camera lock, no cold-blue cyberpunk glow. Tron / SupCom
   / Ender's Game share a visual language that's entirely absent.
3. **Top bar is text, not instrument.** Should be NASA-console gauges:
   decisions gauge, fleet-load bar, $/hr digital readout, events/min spark.
4. **Decision queue is small.** Should be the dominant command-panel strip
   at the bottom (Stellaris production queue / SupCom command bar), not a
   thin rail squeezed beneath the map.
5. **Outliner uses project ID slug, not project name.** Trivial fix but
   a constant low-grade reading-tax.
6. **No annunciator label.** Master caution is just a body glow; no
   "DECISION REQUIRED: PULSE/agent-12" lit strip.
7. **No strategic zoom.** Wheel-out-to-fleet / wheel-in-to-transcript
   not implemented.

Cycle 2 attacks #1, #2, #5 together (territorial map). Cycle 3 attacks #3
(instrument top bar). Cycle 4 attacks #4 + #6 (command panel + annunciator).
Strategic zoom (#7) is its own bigger cycle later.

---

## Cycle 2 — territorial portfolio map + cockpit aesthetic

### Vision recall

- "Center-left: portfolio map. Spatial overview of _projects (territories)_
  and _workstreams (fronts)_. One tile per agent."
- "Strategic zoom (Supreme Commander style)."
- "Dark by default. Healthy = boring screen."

### Plan

1. Group session tiles by `cockpitProjectId`; render each project as a
   labelled glowing disc on a grid floor.
2. Hex-tile geometry, not icosahedron. Flat, seen at angle.
3. Lock camera to oblique (~25° from horizontal); pan + zoom only,
   no rotate. Strategic-zoom feel.
4. Add a real grid floor + horizon fade.
5. Add post-processing bloom for cockpit glow.
6. Use project names (need `/sessions` to expose them — currently only
   `cockpitProjectId`; add a join in the API).

### Implemented

- `/sessions` API now joins `cockpit_projects` and returns `projectName`.
- Outliner uses project name instead of ID slug.
- `PortfolioMap` rewrite:
  - Sessions grouped by project into spatial **territories** (centred for 1,
    side-by-side for 2, polar layout for 3+). Each territory is a glowing
    ring with project name + live/blocked counts as 3D text labels.
  - Tile = hex cylinder (6-sided cylinder, low height). Floor halo glow disc
    underneath. Tile colour = state, pulse = needs-decision/blocked.
  - Camera framed automatically to the bounding circle of all territories;
    locked to oblique angle (~22° from horizontal). MapControls: pan + zoom
    only, no rotate. Strategic-zoom feel.
  - Cold-blue ambient + warmer rim light. Fog matched to background.
  - Stopped/merged sessions older than 1h filtered off the live map (vision:
    "healthy = boring screen", not "boring screen full of corpses").
  - Tile dimensions doubled (radius 0.32 → 0.55), emissive intensity raised
    so tiles bloom hard and read at fleet zoom.
  - Post-processing: Bloom (intensity 1.4, mipmap blur) + Vignette.

### Pixel-sample evidence

Sampled 64×128 canvas via toDataURL. Histogram: 4653 black, 2324 grey,
794 deepblue, 330 blue, 53 cyan, 30 green, 0 amber/red (correct: no
needs-decision active). Bright rows span y=20-48, peak intensity at row
y=42 — confirms oblique camera + multiple territory rings visible at
different z-depths, matches Supreme Commander strategic view.

### Known gaps still open

- Map only shows live agents (good); no way yet to see "history" view.
- Strategic zoom into transcript not implemented (deferred to later cycle).
- Top bar still plain text (cycle 3).
- Decision queue still a thin strip (cycle 4).
- Annunciator label not implemented (cycle 4).

---

## Cycle 3 — instrument-grade top bar + annunciator

### Vision recall

- Top bar: glanceable summary, always visible.
- Aviation glass cockpit — three-state colour grammar (red/amber/blue);
  master caution / annunciator pattern.
- Two-stage attention grab: caution glow → labelled annunciator.

### Gap addressed

Top bar was plain-text (`0 decisions · 0 required · 6 live agents · fleet ok`).
No instrument feel, no annunciator, no readouts that change shape.

### Implemented

- New `SummaryLine`:
  - **Decisions gauge** — circular SVG arc, fills as queue grows; stroke
    colour switches dim-blue → amber → red by severity; live count in centre.
  - **Fleet bar** — segmented bar, blocked + live + idle slots. Live/total
    readout below with ▲ N marker when blocked.
  - **Burn readout** — LCD-style $/min with note "est · live × $0.18"
    (placeholder; real cost wiring is a later cycle).
  - **Events sparkline** — 60-second rolling buckets from a new
    `recentEventTimes` ring buffer in the cockpit store. WS messages
    push timestamps via `recordEvent()`. Cyan polyline with drop-shadow
    glow.
  - **FLEET state** label (FLEET OK / FLEET BLOCKED / FLEET IDLE) in
    monospace tracked-out caps.
- New **annunciator strip** rendered above the instrument row only when
  there's an open decision — pulses (caution-pulse animation) when severity
  is `required`, amber/static when `advisory`. Names the worst thing
  in the queue: `DECISION REQUIRED · security concern · PULSE/ANNUNCIATOR-TEST`.

### Observed

- Spawning a Write-to-.env agent on PULSE produced the strip:
  `DECISION REQUIRED  · security concern · PULSE/ANNUNCIATOR-TEST · oldest just now`
  with the gauge filled to 1, fleet bar showing ▲ 1, FLEET BLOCKED in red.
- After running an agent that calls `pwd; ls`, the events sparkline updated
  to `EVENTS 2/min` with the cyan polyline showing the recent burst.

### Known gaps

- Burn readout is synthetic (live × $0.18). Real cost requires aggregating
  `cost.updated` event totals into a session row column, or surfacing
  per-session running cost in the /sessions view. Deferred.
- Sparkline is in-memory only — page reload clears history.

---

## Cycle 4 — command-panel decision queue

### Vision recall

- "Center: decision queue. The primary work surface."
- "List of decisions, oldest first, with one-click verbs."
- Stellaris production queue / Supreme Commander command bar.
- "Situation log > notification feed" — empty state should communicate
  fleet posture, not "fleet is quiet".

### Gaps addressed

1. Queue cards were small / Vercel-card shaped; no command-tile feel.
2. Empty state was a single "fleet is quiet" line — didn't surface
   live-fleet shape.
3. Queue area was fixed 280px regardless of queue depth — buried under map.

### Implemented

- `DecisionQueue` rewrite as a header-bar + 3-column command tile:
  - Header: `DECISION QUEUE  ·  N open · oldest first`.
  - Tile column 1: severity glyph (▲ / ◐ / •) + REQ/ADV/INFO label +
    cooldown remaining. Tinted background by severity.
  - Tile column 2: project/agent caps, trigger type, age. Question + command
    or filePath in monospace.
  - Tile column 3: chunky 3-button bank (APPROVE / REPLY / BLOCK) with
    drop-shadow glow when default-action.
  - Reply expands inline as a full-width textarea row (`⌘↵ send · esc cancel`).
  - Cooldown bar full-width across the bottom.
- Empty state replaced with a fleet-status preview: per-territory live count
  - state breakdown (`COCKPIT-SELF · 6 LIVE · 4 implementing · 2 orienting`).
    Stellaris situation-log feel without the full lifecycle table yet.
- Layout: queue grid row grows with queue depth — 220px (empty), minmax
  280px–38vh (1–2 open), minmax 360px–55vh (3+ open). Map shrinks to match
  but never below `1fr`. Map remains dominant orienting view.
- Spawn button compressed to `+ SPAWN` in tracked-out caps.

### Observed

- Empty state shows 4 territory tiles in a grid with live counts. Queue
  height 219 px.
- Spawning a Write-to-.env decision: queue grows to 324 px, command tile
  shows `▲ REQ · PULSE/COMMAND-TILE-TEST · SECURITY CONCERN · NOW` with
  the three big buttons filling the right side.
- Map shrinks to 444 px vertical (52% of viewport) — still the dominant
  orienting view.

---

## Cycle 5 — persistent outliner / detail-as-overlay

### Vision recall

- Stellaris outliner: persistent right rail with collapsible categories.
- Endsley situation awareness: don't lose Perception when triaging
  Comprehension. Selecting one thing shouldn't destroy the operator's
  spatial mental model of everything else.

### Gap addressed

Selecting a session swapped the outliner out for the detail panel. While
focused on one agent the operator lost sight of the rest of the fleet —
flow-state breaker. To check on an adjacent agent you had to close detail,
then re-select.

### Implemented

- App layout change: outliner stays in the right rail unconditionally.
  Detail panel becomes an absolute-positioned floating window over the map
  area. Stellaris pattern: clicking a planet pops a window over the galaxy
  view, the outliner remains.
- Detail window: 480px wide, positioned right-aligned within the map area,
  with `shadow-[0_0_36px_rgba(125,211,252,0.15)]` accent glow + backdrop
  blur to feel like an inspector window rather than a side panel.
- Esc still closes (handled inside SessionDetail).

### Observed

- Clicked `ws-handler` (orienting) in the outliner: detail panel rendered
  at x=728 width=480, outliner header still visible at far right. Operator
  retains spatial context.

---

## Cycle 6 — cockpit-native spawn surface ("MISSION BRIEF")

### Vision recall

- Tron / Supreme Commander aesthetic: hard edges, monospace caps,
  cold-blue glow, depth.
- The surface you touch to _start_ work should feel like punching launch
  codes, not opening a Vercel form.

### Gap addressed

SpawnModal was a centered web modal with rounded corners and generic
styling. Visual energy on a load-bearing operator action was identical to
"sign up for our newsletter".

### Implemented

- Replaced centred modal with a full-height left-aligned slide-in panel
  ("MISSION BRIEF · spawn a new local agent into a worktree").
- Project picker rendered as a 2-column tile grid (territory tiles), with
  selected tile getting accent glow + filled background. Vision: territory
  is the primary mental model for project.
- Inline "register repo" sub-form for adding a new project without leaving
  the panel.
- Field labels are mono-caps tracked-out tags (`territory`, `brief`,
  `callsign`, `branch`).
- Footer with launch button: `▸ LAUNCH`, chunky 2px border, ok-green glow
  when ready, dim-disabled until territory + brief filled. Footer status
  text reads `READY · LAUNCH` when valid, `SELECT TERRITORY + BRIEF` until.
- Esc closes (handler local to the modal).

### Observed

- Clicking + SPAWN slides in a 480px panel from the left, header reads
  `▸ MISSION BRIEF`, four territory tiles render (cockpit-self, tally,
  pulse, atlas), launch button at bottom-right of panel. Esc dismisses.

---

## Cycle 7 — strategic zoom (Supreme Commander dolly)

### Vision recall

- "Strategic zoom (Supreme Commander style): wheel out to fleet, wheel in
  to a single transcript — no mode switch."
- Endsley pyramid: don't break Comprehension when transitioning to
  Projection. Continuous camera motion preserves spatial mental model.

### Gap addressed

Selecting a session previously just popped a floating panel. The map
camera stayed at the fleet view. The "no mode switch" zoom that gives
SupCom its signature feel was missing.

### Implemented

- New `CameraDolly` component inside the R3F Canvas. Reads
  `selectedSessionId` from the cockpit store; computes the world position
  of the selected tile from the territory layout; lerps camera position +
  lookAt toward a tighter framing centered on that tile (camera at
  height 4, 5 units back along z).
- When deselected, lerps back to default fleet framing computed from
  `sceneRadius`.
- Lerp factor 0.08 per frame — frame-rate-tolerant critically-damped feel.
- `MapControls` is conditionally rendered only when not focused, so the
  dolly owns the camera during a transition without fighting OrbitControls.
- `HexTile` dims other tiles to 25% opacity when one is selected — focus
  effect; the camera also gets closer, so combined effect is "the rest of
  the fleet greys back into the background".
- Selected tile scale bumped from 1.3× → 1.6× for stronger focus.

### Observed (pixel sample)

- Before selection: 52 bright pixels spanning x=13–50 (full-canvas spread).
- After clicking a session: 236 bright pixels concentrated in x=16–39
  (camera closer, tile bigger, others dimmed).
- After Esc: back to 53 bright pixels x=13–50 — camera lerped back to
  fleet framing.

### Known gap

The detail panel still sits on the right side of the map, partially
covering the dollied-in tile. Next-cycle option: shift the detail panel
to the left when zoomed in, or fade the panel's backdrop so the tile
shows through under it. For now the dolly just moves the camera and
the detail-panel position is unchanged.

---

## Cycle 9-12 — activity motion, decision-context, orbit camera, lifecycle hygiene

A combined batch of changes driven by hands-on use. Vision recall: dark
cockpit / decisions over events / situation log / measure ourselves.

### Cycle 9: agent activity motion

- Map tiles now have a continuous **vertical bob** whose amplitude scales
  with token-velocity (tokens/sec over last 30s), and a **halo "heartbeat"**
  whose pulse rate also scales with velocity. Idle tiles barely-there
  breath; hot tiles pronounced bob + bright fast pulse. Operator can see
  at a glance which agents are working hard.
- Activity ripple rings on every event (existing) — three pooled meshes
  per tile, 1.4s expand+fade.
- A fleet-loop generator (/tmp/fleet-loop.sh) keeps spawning tasks every
  8s so the cockpit always has something happening to display.
- Tile rotation tied to velocity tried and rejected — dizzying at fleet
  scale.

### Cycle 10: context-pressure as height + cost wiring

- New columns on cockpit_sessions: cumulativeInputTokens, cumulativeCostUsd,
  contextWindow. Migration 0003.
- CLI adapter parses input_tokens / cache_read_input_tokens / cache_create
  / output_tokens from the result message and publishes turnTokens in
  cost.updated.
- Persistence rolls them up via SQL increment.
- Tile column height = pressure ratio × 3.2 + base. Tall tiles = filling
  context, time to compact / hand off.
- Warning ring on top of column at ≥70% pressure (amber), ≥90% (red).
- BURN renamed to LOAD (live/total, subscription billing reality).
- Cost in detail header prefixed ≈$ with tooltip: "token-equivalent value
  of work done. Subscription users aren't billed per turn".

### Cycle 11: decision-context block on detail panel

- Top of SessionDetail (above timeline) now renders any open decisions for
  this session as a context block: severity glyph + REQ/ADV/INFO label +
  cooldown remaining, the question, the failed command (mono pre), and the
  actual stderr/stdout from the most recent tool.post.
- Inline approve/reply/block buttons on the context block. Reply expands
  inline.
- Focusing a decision (j/k or click) auto-selects its session so the
  detail panel + camera dolly fire — operator never has to make a decision
  blind.

### Cycle 12: lifecycle hygiene + orbit camera

- POST /sessions/:id/stop kills the controller and marks the row stopped.
  Stop button (■ STOP) on detail panel header.
- Orphan sweep on api startup: any session in queued/orienting/implementing/
  validating/needs-decision/blocked with no endedAt → marked stale-zombie.
  Cleared 147 zombies on first run.
- PostToolUseFailure hook registered + mapped to tool.post with synthetic
  exitCode=1. Trigger classifier matches `npm test` / `pytest` / `cargo test`
  in the command, not just toolName. failed-validation decisions now fire
  for real test/build failures via Bash.
- Fixed: hook bridge was stamping ALL events with \_\_skipClassification,
  blocking persistence from creating decisions for tool.post. Now only
  stamps PreToolUse/Notification.
- Camera: dropped MapControls. CameraDolly now does a slow drift orbit
  around the fleet centre when nothing selected (~85s/rev, radius and
  height drift independently). When a session is focused, camera holds
  still (drift would lose your eye while reading transcript).
- Detail panel constrained to map cell only — never spills onto the
  decision queue below.
- Reply button on decision card auto-selects session so detail panel +
  context fire.

### Observed

- Pixel sample: 84% of canvas pixels changing across 2s during orbit
  — scene visibly alive. With orbit + bob + halo heartbeat all on.
- 147 zombies cleared on first sweep; only 2 sessions actually live
  (the rest had been marooned by previous api restarts).
- LOAD readout shows live/total accurately. EVENTS sparkline ticking.
- Decisions queue filling with failed-validation cooldown cards (60s
  drain, default approve) once `npm test` failures started landing.
