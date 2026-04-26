# Phase 2 retrospective

*Written 2026-04-26, end of a single-session UX overhaul. Companion to
`phase-1-retro.md` (which scored phase 1 against the academic
foundations) and `state-of-the-system.md` (which is the factual snapshot
of what shipped). This file is the candid look at what we set out to do
this session, what we shipped, what we punted, and what we should
remember.*

---

## TL;DR

The session took the cockpit from *"a working dark cockpit with a
disc-per-project map"* to *"a fleet view that feels alive"*: hex-tile
terrain that grows as agents commit, a Tron horizon, identity rings
under every agent, a peripheral news ticker, and a unified
spawn-an-agent flow. Six of seven planned slices landed. The seventh
— **pressure feedback** — didn't.

If phase 1 made the operating picture *visible* and phase 1's retro
called for it to become *interpretable*, this session moved it toward
**interpretable through spatial metaphor**. Agents don't just have
states anymore; they have *territory*. Files they've touched are
visible cells on the floor, ownership cascades when an agent merges,
the world has an edge.

What we still owe — and what the phase 1 retro flagged as missing —
is **comprehension** of *quality* and *trust*. We can see what an agent
*has done* (territory) and what it's *doing now* (tower position,
identity ring). We still can't see how *good* the work is, whether the
operator's prior decisions agreed with reality, or which agents have
earned more autonomy. Those are still phase-3 concerns.

---

## What we set out to do

The session opened on a UX iteration loop. Early goals:

1. Continue the queue / detail / map structural changes from the prior
   session.
2. Address layout breathing room, hover affordances, keyboard nav.
3. Build the territory-map vision: agents as growing islands, commits
   as tiles, merging as land redistribution.
4. Polish: skybox, news ticker, scoping surface, redirect mode.

The territory-map vision was the centrepiece. It came from the user's
prompt mid-session: *"each project can be an island of tiles. As the
agent produces commits, a tile should fill in… as a branch is merged
the tiles disappear animating out in a satisfying candycrush kind of
way."* I sliced it into six (then seven) pieces of work and aimed to
finish them all.

## What we shipped

### Structural / interaction

- Floating-panel layout. Queue + SessionDetail + TileDetail all glass
  panels over the canvas, no docked sidebars. Camera xBias keeps the
  fleet visible past the panels.
- HUD slide-down annunciator (replaces the old top-of-app red band).
- Tab-trap inside SessionDetail.
- Vim-style nav: `j/k` cycle decisions, `Shift+J/K` cycle agents,
  `l/h` step in/out of detail, `Enter`/`a` approve, `i` redirect.
- Redirect mode in SessionDetail: severity-tinted band, tabs labelled
  "▸ SEND REDIRECT", submits to `api.reply`.
- Briefing aesthetic propagated across most surfaces. Major Mono
  Display loaded as the stencil display font.

### The territory map (slices 1-5)

- **Slice 1** Git intelligence service. `git-intel.ts` reads commits,
  cumulative changed files, merge status, optional `gh` PR status. A
  6 s territory poller hashes intel and emits `territory-updated`
  events when shape changes. WS broadcaster forwards them. Backend
  route + caching + diff endpoint.
- **Slice 2** Hex grid + island geometry. Pure hex math, project
  islands snap to a global grid, glass-tile bed with variable depths
  (terrain texture), wireframe outlines on every prism edge.
- **Slice 3** Tile allocator. BFS-from-seed, contiguity guaranteed,
  round-robin fairness, allocator output zipped against
  `changedFiles` so each cell maps to a file. Agent towers float
  over their newest claimed tile. Centre-of-mass identity rings.
- **Slice 4** Land redistribution on merge. `redistribute()` +
  `freedCells()` pure helpers; per-frame colour lerp + candy-crush
  Y-scale bounce on cells whose ownership changed.
- **Slice 5** TileDetail panel. Click a claimed tile → diff viewer
  with cyberpunk syntax-highlighted unified diff (hunk + meta +
  +/- coloured lines), file path, status badge, +/- counts, PR
  badge. New diff route on backend. 8 tests on the diff parser.

### Atmosphere

- Tron horizon: cylinder skybox with vertical gradient + bright cyan
  ring, opaque ground disc closes the gap to the hex floor.
- News ticker along the bottom — Redis-backed peripheral event feed,
  filters firehose to errors / notifications / decisions / plan
  changes. Live + replay-on-mount.
- Unified spawn modal in briefing aesthetic: project picker + new-
  project form + markdown brief editor with image drop. Replaces
  AddProjectModal.
- Identity ring rotation under every agent (Laughing-Man-style),
  per-glyph placement on the floor plane with a wraparound character
  marquee tile.

### Tests

90 green across both packages. From phase-1's 22 (pre-session) to 90
(end-of-session). Coverage spans hex math, allocator correctness,
git-intel parsing edge cases, ticker classification, redirect store
lifecycle, diff parser line classification.

---

## What we didn't ship

### Slice 6 — pressure feedback

**Plan.** Long-lived unmerged territories grow visibly larger or
brighter to signal "this needs reviewing soon". A red-pulsing island
= something's been waiting too long without merging.

**State.** Not built. Capacity ran out before this slice.

**Why this matters.** Phase 1 retro called out the lack of metrics
that measure ourselves. Pressure feedback would have been *one*
operator-facing metric: the visual encoding of "branch lifetime
without merging". With agents constantly drifting toward unmerged
work backlog, this is the visual cue that prevents the operator from
forgetting an old branch.

**Resume here.** Hooks already in place: `intel.commits.length`,
`intel.merged`, `intel.worktreeModifiedAt` are all server-side. The
allocator already provides `seeds` per session. A simple pressure
formula (e.g. `commits / max(commits) × age-decay`) → tile-cluster
emissive intensity boost is one frame's work.

### Things outside the planned scope but still missing from the vision

The phase-1 retro was sharp on what phase 1 punted. This session
addressed almost none of that, by design — we were focused on the
spatial map. The unaddressed list:

- **Per-capability autonomy matrix (Sheridan).** Vision principle 5
  is still unimplemented. Each agent's autonomy is a flat
  trusted-default preset; no UI to express per-capability levels;
  no policy lookup before the classifier fires.
- **Decision ledger UI.** `cockpit_decision_ledger` is written on
  every resolution; nothing queries it. No "show me decisions on
  this branch" view, no PR-attribution.
- **Trust calibration metrics (Lee & See, METR).** No
  decisions/hour, no blocked time, no accepted-diff rate, no
  rework rate, no cost per merged PR, no abandoned-session count.
- **Situation log.** The "fleet standby" state is still an empty
  list of live agents, not a `cockpit_situations` table with
  lifecycle + SLA + owner.
- **Comprehension layer (Endsley).** TileDetail shows *what*
  changed (file diff), but not *why* — no link from a file's
  recent edit back to the decision that authorised it.

This session's work made the **spatial** dimension comprehensible.
The **temporal** and **causal** dimensions are still phase-3.

---

## Vision principles, scored after phase 2

Updating the same matrix from phase-1 retro:

| # | Principle | Phase 1 | Phase 2 | Evidence |
|---|---|---|---|---|
| 1 | Dark cockpit by default | ✅ | ✅ | Tron horizon, glass panels, master caution moved to HUD |
| 2 | Notification → decision queue | ✅ | ✅ | Floating cards, side-tab approve/redirect, vim nav |
| 3 | Situation log > notification feed | 🟡 | 🟡 | News ticker added (errors / notifications / decisions / plan), but still no `cockpit_situations` lifecycle |
| 4 | Decision ledger as canonical history | 🟡 | 🟡 | No change. Backend writes, no UI |
| 5 | Per-capability autonomy | ❌ | ❌ | No change. Still trusted-default preset only |
| 6 | Grand-strategy framing | ✅ | ✅✅ | Hex islands replaced single-disc territories, agents grow visible territory, Tron horizon |
| 7 | Many isolated workstreams | ✅ | ✅ | Worktree per agent, no agent-to-agent |
| 8 | Measure ourselves | ❌ | ❌ | No new operator-facing metrics |

The headline shift: principle 6 went from "shipped" to "shipped well".
We didn't move principles 3, 4, 5, or 8 forward.

---

## Calibration: what I'd do differently

Things that cost more time than they should have, captured for the
next session.

### WebGL context loss is a debugging trap

A long stretch of the session was spent trying to figure out why hex
tile pointer events stopped working. Click + hover both fell through
to `onPointerMissed`. I kept changing geometry / material / event
plumbing. The actual cause was **WebGL context loss** —
`meshPhysicalMaterial` with transmission, plus 2048×2048 shadow maps,
plus bloom postprocessing on N×127 instances was over the GPU budget.
The console showed it (`THREE.WebGLRenderer: Context Lost.`) and once
the context was lost, raycasts hit stale matrix data. Fixed by
dropping transmission and shrinking shadow maps.

**Lesson.** When R3F event handlers stop firing, **read the console
first**, before going hunting in JSX/extensions/materials. Saves an
hour of stabbing at the wrong layer.

### Material chain across two layers of indirection

Setting per-instance colour on `instancedMesh` interacts in non-
obvious ways with: `material.color` (multiplied), lighting
(modulated), `theme="dark"` from `@uiw/react-codemirror` (overrides
custom themes), `dark: true` on the EditorView.theme (without it the
light defaults bleed through). Three different bugs presented as
"colour wrong":

1. **Tiles too dark** — `material.color = accent` was multiplying
   per-instance colour by accent, so accent² appeared instead of
   accent. Fixed by white material colour.
2. **Tiles too bright** — switching to white material let the
   ambient + diffuse light wash everything to grey. Fixed by
   switching to `meshBasicMaterial` (unlit).
3. **Heading colour rosy-pink in editor** — `theme="dark"` from
   `@uiw/react-codemirror` was injecting its own syntax highlight
   that beat ours. Fixed by `Prec.highest()` on our highlight.

**Lesson.** When two competing systems contribute to a visual, write
down the chain of multiplications/overrides before changing
anything. The right "colour fix" is rarely a colour change.

### Slice planning paid off

Six slices, each shippable on its own with a typecheck + verify-in-
browser checkpoint, was the right cadence. When tests caught real
bugs (the phantom extra commit in `readCommits` from
`--shortstat` parser drift; the perspective-foreshortening false
horizon dark-band), they did so before the bug compounded into
something diffuse.

**Lesson.** Keep doing slice-level vertical cuts, even at the cost
of slower visual progress on any single slice. The test moats matter
because the canvas hides everything: typecheck doesn't tell you the
hexes are misaligned.

### Test coverage is biased toward pure helpers

The new test suite (90 tests) covers pure logic well. It does NOT
cover route handlers, React component rendering, multipart upload
guards, or the cell→file zip inside a `useMemo`. Those are the bits
most likely to have integration bugs we won't catch from hex math
alone.

**Lesson.** Next phase, bring up a route-level integration setup
(`fastify.inject`) so the boundary between lib and route doesn't
remain invisible to CI.

---

## What I want to remember for next session

1. **Slice 6 (pressure feedback)** is still unfinished. First task.
2. **No spawned-agent end-to-end test of the territory map.** Every
   visual confirmation in this session ran against seed sessions
   with placeholder worktree paths — meaning every Slice 3/4/5
   loop was *plumbed* but not *seen*. The first thing to do next
   session is: spawn a real agent on a real local repo, watch a
   tile claim, watch a colour change on commit, watch the
   redistribution on merge. If that's wrong, we won't know.
3. **The cell→file zip is positional and assumes both lists are
   stable**. They are today. Document that explicitly somewhere
   so a future change to the diff order doesn't silently misalign
   cell colour.
4. **Phase 1 retro's biggest gaps remain unaddressed**. Per-capability
   autonomy (Sheridan), decision ledger UI, trust metrics (METR
   / Lee & See), situation log (Endsley). These are the things
   that turn a *visible* cockpit into a *trustworthy* one.
5. **The WebGL pressure budget is real.** We're already trading
   shadow quality + transmission for stability. Adding more
   visual effects will need to swap something else out, not pile on.
6. **Test coverage gaps** — `routes/territory`, `routes/ticker`,
   `routes/uploads`, `git-intel.readFileDiff`, the cell↔file zip.

---

## Last verified

- 2026-04-26. End of this session.
- 90/90 tests green across `cockpit` and `cockpit-api`.
- All packages typecheck clean.
- Manually validated in Chrome: hex tile hover / click, spawn modal,
  tile detail panel, news ticker, identity rings, Tron horizon.
- *Not* validated: full territory map loop against a real spawned
  agent (only seed data exercised).
