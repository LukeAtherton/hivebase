# View inventory

*Drafted 2026-04-26 in the `ux-audit` worktree, after `stage-bottleneck-
matrix.md` and `scoping-trace-canonical.md`. This is the per-view
specification: what does each view need to be, what information goes
on it, in what priority, with what interaction flow.*

*The inventory is split into:*
- *Existing views — assessed against the stage model, marked
  keep / refactor / kill.*
- *Missing views — proposed, with information hierarchy and
  interaction flow sketched.*
- *Cross-cutting infrastructure — out-of-window channels and
  invisible-but-required machinery.*

---

## How priority is assigned in each view

Each view lists its information slots in **priority order**, defined by
this rule of thumb: *if the operator could see only this slot, would
they get the highest-leverage decision-relevant fact?* Slots are
roughly ranked into:

- **P0 (load-bearing):** removing this slot makes the view useless.
- **P1 (high value):** the slot earns its real estate every glance.
- **P2 (situational):** valuable when the operator needs it; otherwise
  noise.
- **P3 (deferred):** documented for completeness but not built yet.

The rule cuts against the temptation to add more — every P3 has to
*earn* a promotion by surfacing a real bottleneck, not a cool capability.

---

## Existing views — assessment

### Portfolio map (P0, keep — the orienting surface)

`apps/cockpit/src/scene/PortfolioMap.tsx`

**Stage relevance.** Stage-agnostic — the spatial overview of the whole
fleet. Useful in scoping (where is there capacity for a new agent?),
implementation (who's doing what?), verification (who's done?).

**What works.** Multi-channel encoding (state colour, pressure-height,
velocity-bob, halo-heartbeat, ripple-on-event, decision-pulse) is
genuinely informative — Endsley Perception layer done right. The
oblique drift orbit gives you motion-cue without rotation interaction.

**What's wrong.**
- *No filter.* At fleet-stress (10+ agents) the operator can't say
  "show only blocked." Vision called this out (Shneiderman zoom-and-
  filter) and it's unbuilt.
- *No stage encoding.* A scoping-stage agent looks identical to an
  implementation-stage one. Operator can't see "who's in scoping" at a
  glance.
- *Per-tile preview is selected-only.* The retro flagged this as a
  Pirolli scent gap.
- *Hover doesn't preview.* Same gap.

**Information hierarchy (proposed):**

| P  | Slot                          | Notes |
|----|-------------------------------|-------|
| P0 | Tile = agent                  | One per live session; existing |
| P0 | Colour = state                | Existing; extend to encode stage too |
| P0 | Pulse = open decision         | Existing; extend with stale-since |
| P1 | **Stage badge on tile**       | NEW — small icon: scoping/impl/verify |
| P1 | Heartbeat = recent activity   | Existing |
| P1 | **Hover preview**             | NEW — agent name, current activity, age, open decision count |
| P2 | Pressure-height = token load  | Existing — but mistake-prone (cumulative); rethink |
| P2 | **Filter chips above map**    | NEW — by stage / state / project / severity |

**Interaction flow.**
- Click tile → SessionDetail floats, dollies camera. *Existing.*
- Hover tile → preview tooltip with name + activity + age + decision count. *NEW.*
- Filter chip → re-projects map, dimmer for non-matching tiles. *NEW.*

**Verdict: keep, with stage-encoding + hover + filter as next iteration.**

---

### Summary line (P0, keep — the always-visible annunciator)

`apps/cockpit/src/components/SummaryLine.tsx`

**Stage relevance.** Stage-agnostic. The vision's "glanceable summary
line": *"7 decisions, oldest 4h, 3 unblock 5 agents — fleet ok, $24/h
burn."*

**What works.** Always-visible ribbon, master caution / amber pulse
encoded into the page background, decision counts, sparkline.

**What's wrong.**
- The "tokens ≈$X" label is honest about being a denominator, but it's
  not load-bearing. Real cost surface is what's wanted.
- *No stage breakdown.* "3 in scoping, 7 in implementation, 1 in
  verification" would be useful at-a-glance.
- *No "decisions you've already made today" counter.* Useful for the
  per-capability autonomy bottleneck — a high count means too much
  reaching the human.
- *No median-decision-queue-age* — the leading indicator from the
  retro. (Lower priority now per the throughput reframe, but still
  cheap to surface.)

**Information hierarchy (proposed):**

| P  | Slot                                      | Notes |
|----|-------------------------------------------|-------|
| P0 | Master caution colour                     | Existing |
| P0 | Open decisions: count                     | Existing |
| P0 | Open decisions: oldest age                | Existing |
| P0 | Required vs advisory split                | Existing |
| P1 | **Live agent count + stage breakdown**    | UPGRADE — currently just total |
| P1 | **Decisions resolved today (counter)**    | NEW — proxy for autonomy-tax |
| P2 | Events/min sparkline                      | Existing — keep, low prominence |
| P2 | **Median open-decision age**              | NEW — leading indicator |
| P3 | Cost/hour                                 | Defer — needs JSONL parser |

**Interaction flow.** Click any segment → focuses the relevant
sub-surface (count → queue, agent count → map, etc.).

**Verdict: keep, refactor for stage breakdown + autonomy counter.**

---

### Decision queue (P0, refactor — currently implementation-only)

`apps/cockpit/src/components/DecisionQueue.tsx`

**Stage relevance.** Today: implementation-only. Tomorrow: implementation
+ verification handback (scoping decisions go to the scoping surface,
not the queue).

**What works.** Aged oldest-first, severity stripe, cooldown bar,
default-choice highlight, one-click verbs, j/k focus cycling.

**What's wrong (per the trace + bottleneck #4):**
- *Question text is too terse.* "npm build failed" is the symptom; the
  card needs the *cause and the choice being asked for.* Today the
  classifier outputs short questions and the card displays them
  verbatim.
- *No "what was the agent trying to do" context on the card.* You
  have to click into SessionDetail.
- *No structured reject options.* Reply is freeform; common rejects
  (retry-with-X, change-approach, skip) aren't templated.
- *No agent-history breadcrumb on the card.* "This agent has approved
  47 of 50 similar decisions" would calibrate the operator's response
  (Lee & See trust). No persistent agent identity yet, but planning
  for it.
- *No "what happens next on approve / on reject" preview.*
- *Stage-agnostic UI for stage-specific decisions.* Verification
  decisions ("does this diff match scope?") will not fit this card
  shape.

**Information hierarchy (proposed):**

| P  | Slot                                          | Notes |
|----|-----------------------------------------------|-------|
| P0 | Severity stripe                               | Existing |
| P0 | **Classifier-enriched question**              | UPGRADE — not "npm build failed" but "build failed (exit 1) — agent ran `pnpm build`, lockfile mismatch suspected. Retry with `npm install --force`, change approach, or block?" |
| P0 | Default choice highlighted                    | Existing |
| P0 | Cooldown bar (if applicable)                  | Existing |
| P1 | **Inline evidence (last 3 lines of stderr)**  | NEW — evidence on card, not behind click |
| P1 | **What-was-agent-trying line**                | NEW — "agent was attempting to validate auth refactor before opening PR" |
| P1 | One-click verbs                               | Existing |
| P1 | **Structured reject options menu**            | NEW — common templated replies |
| P2 | Agent name + project                          | Existing |
| P2 | Time waiting                                  | Existing |
| P3 | **Agent competence breadcrumb**               | DEFERRED — needs persistent agent identity |
| P3 | What-happens-next preview                     | DEFERRED |

**Interaction flow (current).**
- Card visible in queue → cooldown counts down → on expiry, default
  applies; or operator clicks verb → resolves → ledger entry.

**Interaction flow (proposed addition).**
- Hover card → expand inline (not modal) showing more evidence + reject
  options. *Hover-pause cooldown.*
- Click "structured reject" → menu of templated replies.
- Click any verb → optimistic UI + ledger entry. (Existing.)

**Verdict: refactor heavily. Card v2 is one of the named cross-cutting
deliverables.**

---

### Session detail panel (P1, keep + simplify)

`apps/cockpit/src/components/SessionDetail.tsx`

**Stage relevance.** Stage-agnostic, but information needs differ per
stage. Today it's an implementation-stage transcript view; in scoping
stage, the artifact replaces it; in verification, the diff/test view
replaces it.

**What works.** The decision-context block (failed command + stderr
pinned above the timeline) is the right shape — Endsley Comprehension.
Live transcript stream. Cost per turn (honest about being denominator).
Stop button is functional.

**What's wrong.**
- *Floats over the dollied tile, partially obscures it.* Acknowledged
  in known-rough; not fixed.
- *Duplicates stat info from the SummaryLine and tile encoding.* Could
  be denser.
- *"Send message" affordance is buried.* The reply-into-live-session
  capability is there but the UI doesn't lead with it.
- *No diff view.* For verification, you'd want the cumulative diff
  visible here (or in a sibling surface). Today: nothing.

**Information hierarchy (proposed):**

| P  | Slot                                                 | Notes |
|----|------------------------------------------------------|-------|
| P0 | Decision-context block (when decision open)          | Existing — load-bearing |
| P0 | Agent name, stage, state                             | UPGRADE — add stage |
| P0 | Live transcript stream                               | Existing |
| P0 | Send-message input                                   | UPGRADE — make primary, not buried |
| P1 | Current plan / todos                                 | Existing |
| P1 | Stop button                                          | Existing |
| P2 | Cost / token denominator                             | Existing — keep low prominence |
| P3 | **Cumulative diff view tab**                         | NEW for verification stage |
| P3 | **Per-agent competence stats**                       | DEFERRED — needs persistent identity |

**Interaction flow.** Mostly unchanged. Send-message gets promoted from
"after scrolling to bottom" to "always visible at bottom of panel."

**Verdict: keep, with stage badge + send-message promotion + diff tab
when verification surface lands.**

---

### Session outliner (P2, refactor — currently duplicative)

`apps/cockpit/src/components/SessionOutliner.tsx`

**Stage relevance.** Today: stage-agnostic per-project session list.
Mostly mirrors what the map already shows.

**What works.** Project-grouped list of sessions. Click → select.

**What's wrong (per state-of-the-system known-rough):**
- *Duplicates information already on the map.* This was discussed
  during phase 1 and punted.
- *Flat list — no situation log.* The vision's principle 3
  (situation-log-not-feed) is unbuilt; the outliner is where it
  could live.
- *No filtering, no scenes, no "starred" agents.*

**Two design directions:**

**Option A — repurpose as situation log.** Replace per-session list
with durable-problem objects. "PULSE auth refactor stalled 4h." "PCB
agent on third loop." Each has lifecycle, owner, SLA.

**Option B — kill, claim the right rail for the scoping surface.** When
an agent is in scoping, the right rail becomes the scoping artifact.
When no agent is in scoping, the rail becomes the situation log (option
A reduced to one column).

**Recommendation: Option B.** The right rail is the scarcest real
estate in the layout — claim it for the highest-bottleneck use
(scoping). Situation log can live in a footer strip when present.

**Information hierarchy (situation-log mode):**

| P  | Slot                                  | Notes |
|----|---------------------------------------|-------|
| P0 | Situation title + age                 |  |
| P0 | Affected agent(s) / project            |  |
| P1 | Lifecycle state (open / acknowledged) |  |
| P1 | Suggested next action                  |  |
| P2 | Owner (when multi-user)                | DEFERRED |

**Verdict: refactor. Preferred direction: claim rail for scoping
surface, demote situation-log to a footer.**

---

### Spawn modal (KILL — replaced by scoping surface)

`apps/cockpit/src/components/SpawnModal.tsx`

**Stage relevance.** Today: only scoping-stage entry point. Tomorrow:
should be replaced entirely by the scoping surface.

**What works.** It exists, it has a project picker, it works end-to-end.

**What's wrong.** *Everything the trace and matrix said.* Compresses the
entire scoping stage into a single textarea, with no agent participation,
no artifact, no hand-off. It is the *symptom* of bottleneck 1.

**Verdict: kill in v2.** Replace with scoping surface (below). Until
that ships, keep as fallback.

---

### Keymap overlay (P2, keep)

`apps/cockpit/src/components/KeymapOverlay.tsx`

**Stage relevance.** Stage-agnostic discoverability.

**Verdict: keep, no changes.**

---

### Toasts (P2, keep with discipline)

`apps/cockpit/src/components/Toasts.tsx`

**Stage relevance.** Stage-agnostic. Ephemeral feedback.

**What's wrong.** Could degrade into Slack-style notification firehose
if used carelessly. The vision is explicit: notifications become
decisions, not toasts. Toasts should be limited to *the cockpit's own
operations* (e.g., "session started", "decision approved") — not agent
events.

**Verdict: keep with strict scope discipline.**

---

## Missing views — proposed

### Scoping surface (P0, new — the bottleneck-1 fix)

The single most important new view. Replaces SpawnModal entirely.

**Stage relevance.** Scoping-only. When the agent is in scoping stage,
this view dominates. When the agent transitions to implementation, the
artifact becomes a read-only reference and the existing views take over.

**What it is.** A two-pane surface:

```
┌────────────────────────────────────────────────────────────┐
│  scoping · <project> · <agent label>           [agreed →]  │
├──────────────────────────────────┬─────────────────────────┤
│                                  │                         │
│  conversation                    │  scope artifact         │
│                                  │                         │
│  operator: <message>             │  ▸ task                 │
│  agent: <message>                │    [editable]           │
│      ↳ cited file: foo.ts:42     │                         │
│  operator: <message>             │  ▸ acceptance criteria  │
│                                  │    1. [editable]        │
│  [reply input ────────────]      │    2. [editable]        │
│                                  │                         │
│                                  │  ▸ non-goals            │
│                                  │    [editable]           │
│                                  │                         │
│                                  │  ▸ touch surface        │
│                                  │    [auto-detected list] │
│                                  │                         │
│                                  │  ▸ autonomy preset      │
│                                  │    [policy editor]      │
│                                  │                         │
│                                  │  proposed ─→ agreed     │
│                                  │  [send-back] [agree]    │
│                                  │                         │
└──────────────────────────────────┴─────────────────────────┘
```

**Information hierarchy (priority):**

| P  | Slot                                          | Notes |
|----|-----------------------------------------------|-------|
| P0 | **Conversation pane**                         | Live chat with the read-only agent |
| P0 | **Scope artifact pane**                       | Editable task / criteria / non-goals |
| P0 | **Agree button**                              | The scoping → implementation transition (spawns fresh impl agent — see `agent-handoff-decision.md`) |
| P0 | Reply input (always visible)                  | Operator's primary action |
| P0 | **Touch surface auto-detection**              | UPGRADED to P0 — implementation agent has no other source for which files are in scope |
| P0 | **Acceptance criteria (specific, testable)**  | UPGRADED to P0 — these ARE the impl agent's success spec |
| P0 | **Non-goals**                                 | UPGRADED to P0 — without these, impl agent re-litigates settled decisions |
| P0 | **Citations captured into artifact**          | UPGRADED to P0 — chat dies at handoff; only artifact survives |
| P1 | **File citation rendering inline (in chat)**  | When agent says "saw `foo.ts:42`," it's a clickable preview that promotes into the artifact |
| P1 | **Autonomy preset editor**                    | Per-capability toggles, defaulted from a preset, travels with artifact |
| P1 | **Send-back action** (vs agree)               | Sends the artifact back for revision |
| P2 | **Stale-marker on prior agent proposals**     | When operator-context invalidates earlier reasoning |
| P2 | **Multi-option scoping question rendering**   | When agent asks "A or B?" with implications |
| P2 | **Artifact version history**                  | Diff between revisions of the artifact |
| P3 | **Context-loading instruction slot**          | First-class "read these files in this order" input |
| P3 | **Structured-deliverable shape declaration**  | "Respond with (a), (b), (c)" |

**Interaction flow (canonical scoping session):**

1. Operator clicks "+ scope new agent" (was "+ spawn") on the map.
2. New scoping surface opens. Operator writes initial brief in the
   reply input. Agent (read-only, no edit capability) starts.
3. Agent reads files, cites them inline, asks clarifying questions,
   drafts the artifact pane as it goes.
4. Operator edits the artifact directly (or replies in chat,
   triggering the agent to update the artifact).
5. When operator types a list in chat, agent extracts to artifact.
6. When operator pushes back on framing ("not measurement, throughput"),
   the agent visibly marks invalidated proposals as stale.
7. When operator introduces a new structural concept ("we're missing
   stages"), agent proposes a restructuring.
8. Operator reviews the artifact, edits non-goals, adjusts autonomy
   preset.
9. Click **agree** → artifact becomes immutable. Stage transitions to
   implementation. The scoping agent is killed; a **fresh
   implementation agent** is spawned with the artifact as its only
   initial context. (Decision recorded with research backing in
   `agent-handoff-decision.md`.)
10. Right rail flips back to situation log; tile on map updates from
    "scoping" stage badge to "implementation."

**This is the view the trace was *missing the whole time*.**

---

### Verification surface (P1, new)

**Stage relevance.** Verification-only. When agent claims done, this
view is how the operator decides accept / send-back / abandon.

**What it is.**

```
┌────────────────────────────────────────────────────────────┐
│  verification · <agent>                  [accept] [back]  │
├──────────────────────────────────┬─────────────────────────┤
│                                  │                         │
│  agreed scope (read-only)        │  delivered diff         │
│                                  │  + test results         │
│  ▸ task                          │                         │
│  ▸ acceptance criteria           │  [diff view]            │
│  ▸ non-goals                     │                         │
│                                  │  ──────                 │
│  agent's done-claim:             │  test results:          │
│  "implemented X, tests pass,     │   ✓ auth.test.ts        │
│   non-goals respected"           │   ✓ user.test.ts        │
│                                  │   ⚠ flaky.test.ts       │
│                                  │                         │
└──────────────────────────────────┴─────────────────────────┘
```

**Information hierarchy:**

| P  | Slot                                  | Notes |
|----|---------------------------------------|-------|
| P0 | Agreed scope (read-only)              | The contract |
| P0 | Delivered diff                        | What the agent actually did |
| P0 | Test results                          | The agent's own validation |
| P0 | Accept / send-back / abandon verbs    | The decision |
| P1 | Agent's done-claim narrative          | Self-report |
| P1 | Diff/scope contradiction flagger      | Diff touched files outside touch-surface? Highlight |
| P2 | Side-by-side scope criteria → diff    | Each criterion has a checkmark or ? |

**Interaction flow.**

1. Agent emits "I'm done" event. Verification decision appears in queue.
2. Operator clicks → verification surface opens (full-window or large
   panel).
3. Side-by-side: agreed scope on left, diff on right.
4. Operator scrolls diff, scans test results, decides.
5. Accept → agent transitions to PR/CI stage (deferred). Send-back →
   agent re-enters implementation with operator's specific note.
   Abandon → session ends, ledger entry written.

**Verdict: build after scoping surface. Bottleneck-3-adjacent rather
than bottleneck-1-direct, but pulls more of the day into the cockpit.**

---

### Autonomy policy editor (P1, new)

**Stage relevance.** Cross-stage. Surfaced inline in the scoping
artifact (per-scope preset) and in agent detail (per-agent override).

**What it is.** A small grid widget — capability rows × stage columns,
allow/ask/never per cell. Presets along the top (e.g., "trusted",
"sandboxed", "review-only").

**Information hierarchy:**

| P  | Slot                              | Notes |
|----|-----------------------------------|-------|
| P0 | Capability × stage matrix         | The grid |
| P0 | Preset selector                   | Quick path to common settings |
| P1 | Inline rationale per cell         | "Why is this `ask`?" tooltip |
| P2 | Diff vs default                   | Show overrides explicitly |

**Interaction flow.**

- In scoping surface: pick preset, optionally tweak cells, persists
  with the scope artifact on agree.
- In agent detail: editable mid-flight (within constraints — e.g.,
  can tighten but not loosen during implementation).

**Verdict: build alongside Sheridan implementation. Cheap UI, hard
backend (data model + gate logic).**

---

## Cross-cutting infrastructure (out-of-window / invisible)

These aren't views per se — they're prerequisite plumbing.

### Audio + OS notification channel (P1, new)

For bottleneck 2. The peripheral signal that doesn't require focus on
the cockpit window. Three layers:

- **Audio cue** when a required-severity decision lands on the queue
  while the cockpit window is unfocused. ICU/cockpit pattern. Single
  configurable tone, not a melody.
- **OS notification** (via Web Notification API or Tauri/Electron
  wrapper) on required-severity, with one-click "open cockpit + jump
  to this decision."
- **Menubar/dock badge** count when window unfocused.

Out of scope for the audit's first round of UI changes; flag as the
plumbing that makes bottleneck 2 actually solvable.

### Away/recap surface (P2, new)

Mark-resumption-cost mitigation. When operator returns from being away
(idle detection: no input N minutes, window unfocused, etc.), present a
recap: "while you were away — 3 decisions resolved by default, 1 still
open, 2 agents reached verification." Single dismiss action returns to
the live view.

Could live as a transient overlay on top of the existing layout, or as
a banner above the SummaryLine.

### Persistent agent identity (P2, new — backend mostly)

For bottleneck-3 / Lee & See trust. Today every spawn creates a new
`cockpit_agents` row. To track competence (acceptance rate, merge
rate, decision approval rate), agents need stable identity across
sessions. Schema change + UI surfacing on agent detail.

---

## Proposed layout, after the changes

```
┌──────────────────────────────────────────────────────────────────────┐
│ SUMMARY LINE — caution colour, decisions count + age, stage breakdown,│
│   today's resolved counter, median queue age, sparkline               │
├──────────────────────────────────────────────────┬────────────────────┤
│                                                  │                    │
│  PORTFOLIO MAP                                   │  RIGHT RAIL —      │
│  (with stage badges, hover preview, filter)      │  ┌──────────────┐  │
│                                                  │  │ if any agent │  │
│  + scope new agent                               │  │ in scoping:  │  │
│                                                  │  │ SCOPING      │  │
│  [SessionDetail floats on tile select]           │  │ SURFACE      │  │
│                                                  │  │ (chat + scope│  │
│                                                  │  │  artifact)   │  │
│                                                  │  └──────────────┘  │
│                                                  │  [otherwise:       │
│                                                  │   SITUATION LOG]   │
├──────────────────────────────────────────────────┤                    │
│                                                  │                    │
│  DECISION QUEUE (v2 cards: enriched questions,   │                    │
│  inline evidence, structured reject options)     │                    │
│                                                  │                    │
├──────────────────────────────────────────────────┴────────────────────┤
│ SITUATION LOG strip (when right rail has scoping surface) — collapsed│
└──────────────────────────────────────────────────────────────────────┘

[Verification surface — opens as full-window over the layout when
 invoked from queue or map.]

[Audio + OS notification + menubar badge — invisible infrastructure.]
```

---

## Bottleneck → view mapping

Final cross-check: each operator-named bottleneck has at least one
proposed view-change addressing it.

| Bottleneck             | Primary fix                                  |
|------------------------|----------------------------------------------|
| 1. spawn friction      | Scoping surface (replaces SpawnModal)        |
| 2. peripheral attention| Audio + OS notification + menubar badge      |
| 3. approval-tax        | Autonomy policy editor + Sheridan plumbing   |
| 4. decision context    | Decision queue card v2 (classifier-enriched) |

If a proposed view doesn't trace back to one of these four, we've
drifted into vanity territory. Re-examine.

---

## What this inventory does NOT decide

Deliberately deferred to the canvas + critique step (tasks #5–#7):

- **Visual treatment of the scoping surface** — we know what's on it,
  not what it looks like. Critique against Pirolli scent / Endsley
  Comprehension on actual mocks will tell us.
- **Interaction details of the autonomy policy editor** — preset list,
  cell affordances, mobile.
- **Whether the verification surface is a panel, a window, or its own
  route.**
- **Per-foundation deep-dive** — done in the critique step against
  rendered states, not against this inventory in the abstract.

Next: build the deterministic mock-data seed (task #5), then snapshot
each named state (task #6) and lay them on the React Flow canvas, then
critique (task #7).
