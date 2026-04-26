# Cockpit critique — workflow walk against bottlenecks + foundations

*Drafted 2026-04-26 in the `ux-audit` worktree, reading off the live
audit page at `/audit-canvas` (snapshots from `pnpm canvas:snapshot`,
seeded data from `pnpm db:seed`).*

*This document is the synthesis the audit was for. Inputs were:
`stage-bottleneck-matrix.md` (the spine), `view-inventory.md` (the
per-view contract), `scoping-trace-canonical.md` (the workflow trace),
`agent-handoff-decision.md` (the fresh-context decision), and
`future-work-research.md` (cross-model verification, blackboard
patterns, the exhaust-trail / space-elevator concept).*

*Output: a ranked redesign roadmap, with falsification criteria per
item.*

---

## Method

For each of the 8 workflows traced on the audit page, we score every
step against:

- **Primary lens — the four operator-named bottlenecks.**
  - #1 spawn friction (defining scope is slow)
  - #2 peripheral attention (noticing who's waiting)
  - #3 approval-tax (decisions that don't really need approval)
  - #4 decision context ("no context for me to make a decision")
- **Supporting lens — the eight academic foundations from `VISION.md`.**
  - Sheridan, Endsley, Horvitz, Mark/Czerwinski, Pirolli/Card,
    Lee & See, Shneiderman, Weiser/Brown
- **Honest assessment.** What works. What is half-built. What is
  missing entirely.

Each redesign opportunity is then ranked on:
1. **Bottleneck coverage** — how many of the 4 named bottlenecks does
   it touch?
2. **Throughput leverage** — does it raise the operator's concurrent-
   agent ceiling, or just polish the existing ceiling?
3. **Falsifiability** — how would we know it's working?
4. **Cost** — small / medium / large.

The throughput-leverage column is the load-bearing one given the
operator's reframe (per `phase-1-retro.md` updates and the bottleneck
conversation): the goal is **pushing past the current cognitive
ceiling**, not loss-prevention. The METR framing is explicitly NOT
the prioritisation lens.

---

## Per-workflow walk

### Workflow 1 — Happy path (baseline)

`fleet-overview → scope-spawn-today → impl-healthy → verify-ready`

This is the workflow that *should* be cheapest end-to-end. It isn't.

- **Step 1 — fleet-overview.** Strong on Endsley Perception
  (multi-channel tile encoding) and Shneiderman overview. Weak on
  Pirolli scent (no hover preview, selected-tile-only floater) and
  Shneiderman zoom-and-filter (none). At fleet stress (10+ agents)
  the lack of filter will hurt — but at our current target scale
  it's adequate.
- **Step 2 — scope-spawn-today.** This is **the bottleneck-1 site**.
  A single button → modal → textarea. The operator does the entire
  scoping stage in their head, alone, and emits the result as one
  paragraph. The 11 patterns from `scoping-trace-canonical.md`
  (context-loading instructions, structured deliverable shape, stale-
  marker on prior reasoning, scope-restructuring proposals, living
  artifact with version history, etc.) are *all* unsupported.
- **Step 3 — impl-healthy.** Genuinely good. The Weiser/Brown
  calm-tech ideal: nothing demanding attention, the operator can
  glance and move on. Halo heartbeat + drift orbit produce ambient
  motion. *Caveat:* per `future-work-research.md` §3, the pulse
  animation is *low-info ambient motion* — the exhaust-trail / space-
  elevator framing would deliver the same calm AND make agent
  velocity legible, AND make stuck agents visually obvious without
  needing the audio channel.
- **Step 4 — verify-ready.** The cockpit goes silent. State machine
  hits ready-for-review and there's nowhere to act. Operator falls
  back to editor / browser. *This step is the second-highest leak in
  the workflow* — bottleneck-3 adjacent (operator rubber-stamps
  blind because there's no visible scope-vs-delivered comparison).

**Workflow verdict.** End-to-end through the supposedly-easy path
already exposes two huge gaps: scoping (step 2) and verification
(step 4). Steps 1 and 3 work.

### Workflow 2 — Scoping (proposed)

`fleet-overview → scope-surface → impl-healthy`

A 2-card workflow: where the proposed `scope-surface` (chat +
crystallising artifact) replaces step 2 of the happy path, with
fresh-context handoff into impl. Per `agent-handoff-decision.md`,
the artifact is the entire context the implementation agent will
have — so artifact completeness is load-bearing, not nice-to-have.

The audit can't show a snapshot here (the surface doesn't exist),
but the *information hierarchy* in `view-inventory.md` is detailed
and the trace's 11 patterns provide the test cases. The risk to
manage during implementation: an under-built scoping surface that
ships an artifact-shaped textarea (treating the symptom). The
discriminator: can the captured scoping conversation itself be
replayed through the new surface and feel materially better?

### Workflow 3 — Advisory cooldown — the no-context decision

`impl-healthy → impl-advisory-cooldown → impl-recently-resolved`

The operator's own bottleneck-4 example: "npm build failed — no
context for me to make a decision on that, not even sure what I'm
being asked." Looking at the snapshot: **the card today literally
shows "pnpm test failed (exit 1)" with no stderr, no rationale, no
"what is the agent trying to do," no structured reject options.**

What works: the cooldown bar drains visibly, the default-choice is
highlighted, severity stripe is correct, j/k focus cycling lets you
move through cards quickly. The annunciator strip + master-caution
amber tinting are good two-stage attention grab.

What's broken (Pirolli scent, hard): the card is asking the operator
to decide based on a 5-word summary. The decision-context block in
SessionDetail HAS the stderr and the failed command — it just isn't
on the card. **Fixing the card without changing anything else
materially helps bottleneck 4.**

What's also broken (Sheridan): per `stage-bottleneck-matrix.md`'s
stage-aware autonomy table, "run tests" is `allow` in implementation
stage. A failed `pnpm test` *should not produce a decision at all*
for an agent that's allowed to retry tests. The ask "should I retry?"
is itself the artifact of missing per-capability autonomy.

**Workflow verdict.** Two distinct fixes hide here:
1. **Decision card v2** (richer card) — tactical, immediate.
2. **Per-capability autonomy** (Sheridan) — strategic, stops
   producing this class of decision in the first place.

The card v2 is necessary for the residual `ask`-policy cases. The
autonomy work makes the residual smaller.

### Workflow 4 — Destructive action (required gate)

`impl-healthy → impl-required-destructive → impl-recently-resolved`

This is the one case where the cockpit's current treatment is *almost
right*. Master caution red. No auto-expire. Default = block.
Annunciator names "DECISION REQUIRED". Two-stage attention grab works.

What's missing on the card: the affected paths (`packages/*/tmp` —
six matches per the seed payload) and the agent's rationale. Both
are in the decision payload but not surfaced. Same Pirolli scent
problem as advisory cards, but more dangerous because the operator
is being asked to authorise a destructive op.

The bigger architectural gap (Lee & See trust calibration): we have
**no per-agent track record**. "This agent has approved 47 of 50
similar destructive ops, all reviewed and accepted" would dramatically
calibrate the operator's response. Today every `rm -rf` looks
identical regardless of which agent issued it.

### Workflow 5 — Security path — same UI, different decision

`impl-healthy → impl-required-security → impl-recently-resolved`

The killer comparison. **The cockpit shows the .env edit with
identical visual treatment to the recursive delete.** Same red ring,
same annunciator pulse, same card shape, same default = block. But
they are *very different* decisions: the .env edit is almost
certainly fine; the destructive op could go badly.

This is bottleneck 3 (approval-tax) made structural: the cockpit is
generating identical-cost interruptions for decisions of very
different value. Sheridan per-capability autonomy is the systematic
fix — `Edit(.env*)` on a feature-branch agent could route as
`allow` while `Bash(rm -rf)` on the same agent stays `ask`.

Until autonomy lands, the *next-best mitigation* is severity-
sub-tiering on the card itself: a destructive-action card visually
*louder* than a security-concern card. But this is band-aid territory
— the right fix is policy.

### Workflow 6 — Stale waiting

`impl-healthy → impl-stale → cc-audio → cc-recap`

A required scope-ambiguity decision waiting **38 minutes**. Master
caution is technically still on, the card sits in the queue, but the
operator has not noticed. No escalation. No audio. No OS notification.
No "this has been waiting absurdly long" highlight — the 38-minute
card looks identical to a 3-minute card.

This is bottleneck 2 made empirically visible. The fixes are out-of-
window:
- Audio cue on required-severity creation (Weiser/Brown peripheral
  channel).
- OS notification with one-click "open cockpit + jump to this".
- Menubar/dock badge when window unfocused.
- Differential salience: a 38-minute-old required card should
  visually escalate (Mark interruption science: timing matters).
- Operator-away detection + recap-on-return (Mark resumption-cost,
  bone-deep classic).

The audio + OS path **also subsumes part of the exhaust-trail/space-
elevator framing's bottleneck-2 story**: when the cable stops moving,
that's also a peripheral signal. So we have two converging lines
attacking the same bottleneck.

### Workflow 7 — Context pressure

`impl-healthy → impl-context-pressure → verify-ready`

Long-running migration at ~85% context window. Tile pressure-height
encodes this; nothing else does. **Endsley Projection layer is
entirely missing** — the cockpit knows the token velocity but doesn't
forecast.

The fix here is small and high-signal: add a forecast row in the
summary line ("agent 8: context fill in ~6 min at current velocity")
and on the tile hover preview. Could *also* trigger a pre-emptive
scope hand-back to a fresh agent (per `agent-handoff-decision.md`,
a fresh context is empirically better anyway), turning a quality-
cliff event into a managed handoff.

### Workflow 8 — Verification — the cockpit goes silent

`impl-recently-resolved → verify-ready → verify-surface (proposed) → post-pr-ci (deferred)`

The cockpit's current ready-for-review state is functionally
"nothing to do here, go to your editor." Per the review of
`future-work-research.md` §3, the exhaust-trail framing partially
*subsumes* verification: if the operator has been concurrently
reviewing as the agent worked, the verification stage collapses to
a final sign-off rather than a first-look. So verification UI is
two things at once:
- **A surface for batched review** (when the operator chose not to
  review concurrently).
- **A sign-off ceremony** (when the operator did review concurrently).

The proposed verification surface in `view-inventory.md` (side-by-
side scope ↔ delivered diff ↔ test results) handles both. Cross-
model verification (per `future-work-research.md` §1) attaches at
this stage as a pre-screen.

---

## Foundation-by-foundation scorecard

A different cut: *which foundations are well-served, which aren't,
where do gaps cluster*?

| Foundation        | Status       | Where it shows up |
|-------------------|--------------|-------------------|
| Endsley Perception| ✅ shipped   | Tile encoding, summary line, severity stripes |
| Endsley Comprehension | 🟡 partial | Decision-context block (good); no situation log; no scope-vs-delivered |
| Endsley Projection| ❌ missing   | No forecasts anywhere — token-pressure, time-to-decision, time-to-context-fill |
| Sheridan          | ❌ missing   | One classifier for all agents; no per-capability autonomy data model |
| Horvitz           | 🟡 partial   | Severity tiers + cooldowns (coarse); no operator focus model; no value model on decisions |
| Mark/Czerwinski   | ❌ missing   | No breakpoint detection, no away/recap, no escalation timing |
| Pirolli/Card      | 🟡 partial   | Decision-context block has it; cards don't; tiles have hover gap |
| Lee & See         | ❌ missing   | No persistent agent identity, no track record, no calibration data |
| Shneiderman       | 🟡 partial   | Strong overview, weak zoom/filter, strong details |
| Weiser/Brown      | 🟡 strong-but-could-improve | Calm tile encoding good; pulse animation low-info; no audio |

**Cluster.** Three of the four foundations that score "missing"
are **about understanding the operator's context**, not the agent's:
Sheridan (operator-defined autonomy), Horvitz (operator focus state),
Mark/Czerwinski (operator breakpoints), Lee & See (operator trust
calibration). Endsley Projection is the outlier — it's about
forecasting the agent's context, not the operator's.

The phase-1 build modelled the agent's state in detail and the
operator's state not at all. **Phase 2 should systematically model
the operator.** That's the throughput-leverage frame.

---

## Ranked redesign roadmap

Each item below has: *what it is*, *which bottlenecks it covers*,
*which foundations it advances*, *throughput leverage*, *falsification
criterion*, *cost*. Sorted by leverage × coverage, not by ease.

### 1. Scoping surface (replaces SpawnModal)

The bottleneck-1 fix made concrete in `view-inventory.md`. Two-pane:
chat with read-only agent on left, crystallising scope artifact on
right. "Agree" spawns a fresh implementation agent with the artifact
as initial context (per `agent-handoff-decision.md`).

- **Bottlenecks:** #1 (direct, primary). #3 (autonomy preset rides
  with the artifact). #4 (artifact's acceptance criteria become
  the implementation agent's spec, which means many decisions
  become unnecessary or pre-answered).
- **Foundations:** Sheridan (autonomy preset attached). Endsley
  Comprehension (shared mental model in artifact). Pirolli scent
  (citations inline).
- **Throughput leverage:** the highest. Spawn friction is *the*
  upstream bottleneck — every agent the operator can't be bothered
  to spawn is throughput foregone. Reducing scoping cost from
  "draft a paragraph alone" to "edit an artifact the agent drafted"
  is plausibly a 3-5× reduction in scoping time per agent.
- **Falsification:** time-to-spawn-first-meaningful-edit measured
  before/after. If the new flow is slower than today's textarea
  (because the chat is too noisy, or the artifact UI is fiddly),
  it's failing for trivial cases — needs a fast-path.
- **Cost:** large. New surface, agent-side prompt changes, fresh-
  context handoff plumbing, autonomy-preset data model.

### 2. Per-capability autonomy (Sheridan)

The cockpit-2 plan's Track A item 1, made stage-aware per
`stage-bottleneck-matrix.md`. Per-agent (or per-scope-preset)
capability × stage policy: `allow`, `ask`, `never`. Gate logic
consults policy before classifier fires.

- **Bottlenecks:** #3 (direct, primary). #4 indirectly (fewer
  decisions reach the queue means each decision that does is
  more legible).
- **Foundations:** Sheridan (the entire principle). Indirectly
  Horvitz (most low-value interruptions stop existing).
- **Throughput leverage:** high. Most of the operator's
  approval-tax goes away. Especially valuable on advisory-cooldown
  cases like the seeded `pnpm test` failure.
- **Falsification:** count of decisions surfaced per
  agent-hour. Should drop measurably — but not to zero, because
  legit `ask`-class decisions still need to surface. If it drops
  to near zero we've made everything `allow` and lost gating
  entirely.
- **Cost:** medium-large. Schema (`cockpit_autonomy_policies`).
  UI editor (small). Gate logic (medium — branches need careful
  testing).

### 3. Decision card v2 — classifier-enriched questions

The decision-card refactor in `view-inventory.md`. Card includes:
classifier-enriched question (not "build failed" but "build
failed (exit 1) — agent ran `pnpm build`, lockfile mismatch
suspected. Retry with `npm install --force`, change approach, or
block?"), inline evidence (last 3 lines of stderr), structured
reject options as templated replies.

- **Bottlenecks:** #4 (direct, primary). #2 partially (richer
  cards reduce the "I don't know what I'm looking at" friction,
  not the "I haven't noticed" friction).
- **Foundations:** Pirolli scent (decision-relevant info on the
  card). Endsley Comprehension (what was the agent doing).
- **Throughput leverage:** medium-high. Doesn't reduce decision
  *count* (autonomy does that) but reduces decision *cost*. Each
  decision becomes faster to resolve confidently.
- **Falsification:** time-from-card-appearance to resolution,
  measured per severity tier. Should drop measurably without
  rising rejection rate (reject-rate as control: if it drops, we
  may be giving the operator enough context to spot bad asks).
- **Cost:** medium. Classifier output enrichment is the hardest
  part — needs to read the actual stderr / payload and produce a
  human-shaped question. Card UI is simple.

### 4. Audio + OS notification + menubar badge

The bottleneck-2 fix that no in-window UI can solve. Audio cue on
required creation. OS notification with one-click "open cockpit +
jump to this". Menubar badge count when window unfocused.

- **Bottlenecks:** #2 (direct, only).
- **Foundations:** Weiser/Brown (audio is the missing peripheral
  channel). Mark (escalation timing).
- **Throughput leverage:** medium. Doesn't change cognitive load
  per decision, but reduces wasted *time* on stalled agents.
- **Falsification:** decisions auto-expiring with their default
  before operator notice. Should drop materially.
- **Cost:** small for audio + OS notification (Web Audio API +
  Notification API). Larger if we go the Tauri/Electron wrap path
  for genuine menubar presence.

### 5. Verification surface

Side-by-side scope ↔ delivered diff ↔ test results, with accept /
send-back / abandon verbs. Subsumes the verification gap. Optionally
plus cross-model pre-screen (per `future-work-research.md` §1).

- **Bottlenecks:** #3 (operator stops rubber-stamping blind). #4
  (post-implementation context).
- **Foundations:** Endsley Comprehension (scope-vs-delivered).
  Lee & See trust (track record visible). Pirolli scent
  (diff with annotations).
- **Throughput leverage:** medium-high. Pulls more of the day
  into the cockpit, which is prerequisite for honest end-to-end
  measurement.
- **Falsification:** time-to-merge for trivial PRs measured
  via cockpit vs. via editor. The cockpit path should match or
  beat editor for the easy cases — otherwise it's pure overhead.
- **Cost:** medium. Diff renderer is the hardest part. Test-result
  parser depends on the framework (Jest/Vitest/etc).

### 6. Per-agent persistent identity + competence history

The Lee & See trust-calibration plumbing. Agents persist across
sessions; per-agent stats roll up: PRs opened, merge rate, edit-
on-merge rate, decision approval rate. Surfaced on the agent
detail (and inline on decision cards as "this agent: 47/50
similar approved").

- **Bottlenecks:** #3 (calibrated approvals are faster). #4
  (history-as-context on each card).
- **Foundations:** Lee & See (the principle). Indirectly Sheridan
  (history justifies higher autonomy rungs).
- **Throughput leverage:** medium. Compounds with autonomy and
  card v2 (each a bit better with this data).
- **Falsification:** are operators *changing their decisions* in
  light of history? If history is shown but decision patterns
  don't shift, it's not calibrating.
- **Cost:** medium. Schema change. UI surfacing in three places.

### 7. Operator focus model + breakpoint-aware delivery

Track C from `phase-1-retro.md`, made specific. Detect operator
state (idle / triaging queue / in detail panel / replying). Hold
non-urgent decisions until next natural breakpoint.

- **Bottlenecks:** #2 partially (fewer mid-task interruptions).
- **Foundations:** Horvitz (operator focus). Mark/Czerwinski
  (breakpoints).
- **Throughput leverage:** medium. Less "interrupted while doing
  something else" friction.
- **Falsification:** subjective — how many interruptions feel
  badly-timed? Hard to measure cleanly, but the operator should
  notice qualitatively.
- **Cost:** medium. Focus-state detection is fiddly (window focus,
  idle time, scroll position).

### 8. Endsley Projection — forecasts in the summary line

"Agent 8: context limit in ~6 min at current velocity." "Agent 12:
likely to hit a destructive-action gate in ~3 min based on todo
list." Projection forward, not just perception backward.

- **Bottlenecks:** #2 (forecasts let the operator pre-empt, not
  react).
- **Foundations:** Endsley Projection (the missing third level).
- **Throughput leverage:** small-medium initially, larger as
  forecast accuracy improves.
- **Falsification:** forecast-vs-actual, and operator-actions-
  taken-on-forecast. If the operator never acts on forecasts,
  they're not informative.
- **Cost:** small for token-velocity / context-fill. Medium for
  todo-list-based forecasts (need understanding of common
  patterns).

### 9. Exhaust-trail / space-elevator visualisation

The radical reframe of agent activity (per `future-work-research.md`
§3). Each agent climbs a moving cable, dropping artifacts (tool
calls) as it goes. Click an artifact → diff overlay. Comment inline
→ injected into agent's next-turn context.

- **Bottlenecks:** #2 (stuck agents = cable stops moving =
  visually obvious without audio). New 5th bottleneck (concurrent
  review). Touches #4 indirectly.
- **Foundations:** Pirolli scent (artifact encoding). Weiser/Brown
  (calm motion). Mark (concurrent review reduces resumption cost
  to ~zero).
- **Throughput leverage:** potentially the largest after scoping —
  but speculative. Could backfire (more attention drain) or land
  brilliantly (concurrent review changes the operator's load
  profile entirely).
- **Falsification:** can the operator describe what each agent has
  *recently done* without scrolling the transcript? If yes, the
  trail is doing its job.
- **Cost:** large. New visual paradigm, partial agent-hook protocol
  changes, comment-as-context plumbing.

### 10. Situation log (vision principle 3)

Long-running problems become durable objects with lifecycle, owner,
SLA. Written by the cockpit on agents' behalf (per `future-work-
research.md` §2's blackboard discipline).

- **Bottlenecks:** #2 partially.
- **Foundations:** Endsley Comprehension (durable objects > transient
  events).
- **Throughput leverage:** small early, large at fleet scale (10+
  agents). Without it, the same incident-pattern will surface as N
  events across N agents instead of one shared situation.
- **Falsification:** can the operator answer "is anyone else hitting
  this?" without manual cross-check?
- **Cost:** small for the data model. Medium for the lifecycle UI
  + the heuristics that detect "situations" from event patterns.

---

## What we are NOT going to do (and why)

Listed for discipline — it is too easy to drift into vanity features.

- **Multi-agent consensus / heterogeneous teams.** Per
  `future-work-research.md` §1: heterogeneous teams empirically
  underperform their best member by up to 37.6%. Don't build
  consensus-seeking ensembles for implementation.
- **Direct agent-to-agent messaging / Redis message bus.** Per
  `future-work-research.md` §2: artifact handoff dominates. Agents
  read shared committed state via git; cockpit routes attention.
  No agent-Slack.
- **GitButler virtual branches now.** Per `stage-bottleneck-matrix.md`
  Appendix A: defer. None of the four named bottlenecks are
  unblocked by it; gating semantics get harder in shared workspace.
- **Leading-indicator dashboard as priority work.** Per
  `phase-1-retro.md` updates: the operator has rejected the METR
  framing as the prioritisation lens. A leading indicator is still
  worth shipping cheaply (as a tripwire), but is no longer the
  organising principle.
- **PR/CI/review surface (full).** Out of scope per the matrix.
  Revisit after the three earlier stages have UI.
- **Mobile / cross-device.** Vision-doc deferral. Single-operator-
  desktop is the throughput case.

---

## Sequencing

Three groups, not strict serial dependencies.

**Group A — the must-have spine.**
1. Scoping surface (#1 above)
2. Per-capability autonomy (#2)
3. Decision card v2 (#3)

These three together cover bottlenecks 1, 3, 4 — the three the
operator named that are *cognitive-load* problems, not
peripheral-attention problems. Group A should ship together as
the v0.2 throughput release.

**Group B — peripheral attention + verification.**
4. Audio + OS notification + menubar badge (#4)
5. Verification surface (#5)

These are the bottleneck-2 fix and the day-leak fix. They depend
on Group A in the sense that without scoping artifacts, verification
has nothing to compare against.

**Group C — measurement, history, exhaust trail.**
6. Per-agent persistent identity + competence (#6)
7. Operator focus model + breakpoints (#7)
8. Endsley Projection forecasts (#8)
9. Exhaust-trail / space-elevator (#9)
10. Situation log (#10)

These compound the others. Item 9 is the riskiest (could
materially change cockpit feel for better or worse). Item 6 is
the cheapest big win (data plumbing, small UI).

---

## Falsifiability summary

If we ship Groups A + B and the cockpit doesn't pay off, we should
see at least *one* of these get worse, not better:

- **Sustainable concurrent agent count** stays flat or drops.
- **Time-to-spawn-first-meaningful-edit** doesn't drop.
- **Decisions per agent-hour reaching the operator** stays flat.
- **Time-from-card-appearance-to-resolution** doesn't drop.
- **Decisions auto-expiring before operator notice** stays
  meaningful.

If all five improve, the throughput-ceiling frame is being honoured.
If none improve, the cockpit is a beautiful instrument that doesn't
help. (We don't expect to be able to falsify all five
simultaneously; signal in any of them is meaningful.)

---

## What this critique deliberately leaves vague

- **Specific visual treatment of the scoping surface** — the
  contract is in `view-inventory.md`, but the actual chrome is
  design work. This document avoids prescribing pixel-level shape.
- **Exact autonomy preset names and defaults** — the matrix in
  `stage-bottleneck-matrix.md` sketches a starting point; the
  reality should emerge from operator usage.
- **Whether the exhaust trail replaces the existing portfolio map
  or coexists** — the space-elevator framing is *in addition to*
  the territorial map, but the relative real estate isn't decided.

These are deliberately downstream decisions. The critique's job is
ranking the work, not designing it.

---

## Last verified

2026-04-26. Read `/audit-canvas` against this document to keep them
in sync. If `nodes.ts`, `workflows.ts`, or the seeded data change
materially, re-run `pnpm canvas:snapshot` and update this critique
where the conclusions shift.
