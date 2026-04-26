# Phase 1 retrospective + research roadmap

*Written 2026-04-26, end of in-monorepo build phase. The cockpit was just
extracted from hivescaler into its own repo; this is the moment to look at
what we made through the lens of the academic foundations the vision doc
named, identify what was implemented vs. what was lip-service, and choose
where to take it next.*

---

## TL;DR

Phase 1 built the **substrate** — a working dark-cockpit that can spawn
agents, gate decisions, surface activity, hold the operator's attention with
a Stellaris/Supreme-Commander/Tron visual grammar. It successfully made the
*Perception* layer work. What it largely punted on is the layer above
Perception in every framework we cited: **Comprehension** (Endsley),
**trust calibration** (Lee & See), **mixed-initiative cost-aware
interruption** (Horvitz), **breakpoint-aware delivery** (Mark / Czerwinski),
**information scent** (Pirolli & Card). The Sheridan toggle matrix —
per-capability autonomy — is named in the design but unimplemented.

If phase 1 was "make the operating picture *visible*", phase 2 needs to be
"make it *interpretable* and *delegable*".

The METR finding ("19% slower while feeling 20% faster") is the central
sober warning. We have an event sparkline and a token-load readout. We do
not have any of the metrics the vision said we'd need on day one
(decisions/hour, blocked time per agent, accepted-diff rate, cost per
merged PR, abandoned sessions, rework rate). Without those we cannot
falsify the claim that the cockpit is helping.

---

## What we shipped, by vision principle

Mapping the eight design principles in `VISION.md` against what's actually
in the code today.

| # | Principle | State | Evidence |
|---|---|---|---|
| 1 | Dark cockpit by default | ✅ shipped | `bg-ink` palette, bloom-only abnormal, master caution + annunciator |
| 2 | Notification → decision queue | ✅ shipped | Aged oldest-first queue, classifier filters events to triggers, severity grammar |
| 3 | Situation log > notification feed | 🟡 placeholder | "Fleet standby" empty-state shows live agents per territory, but no `cockpit_situations` table, no lifecycle, no SLA, no owner |
| 4 | Decision ledger as canonical history | 🟡 backend only | `cockpit_decision_ledger` writes on every resolution; no UI to query it; no PR-attribution flow |
| 5 | Per-capability autonomy | ❌ unimplemented | Vision is explicit: a row of toggles per agent (`edit code`, `push branch`, `open PR`, `merge`, `run migration`, `touch prod`, `spend over $X`). We have none of this |
| 6 | Grand-strategy framing | ✅ shipped | Stellaris outliner, Supreme Commander oblique drift orbit, territorial map, no APM micro |
| 7 | Many isolated workstreams | ✅ shipped | Worktree per agent, no agent-to-agent coordination |
| 8 | Measure ourselves | ❌ token-equivalent only | Events/min sparkline + `cumulativeInputTokens`. None of the load-bearing metrics the principle named (decisions/hour, blocked time, accepted-diff rate, rework rate, cost per merged PR, abandoned sessions, human decisions per hour) |

Principles 1, 2, 6, 7 are real. Principles 3, 4, 5, 8 are partial or missing.

That's the candid score.

---

## What the academic foundations actually demand

The vision doc named eight HCI / supervisory-control frames as foundations.
For each, here's what the frame's central claim is, what it would imply we
should have built, what we actually built, and the gap.

### Sheridan — supervisory control, levels of automation

**Central claim.** The operator of a complex automated system is not the
controller; they are a *supervisor* of a controller. The right design
question per task is "what level of automation": from "human does
everything" through "computer suggests, human approves" to "computer acts
unless human vetoes" to "computer acts, optionally informs human". Different
tasks demand different levels.

**Implied UI.** A per-capability autonomy matrix per agent: a 2D grid of
capabilities (edit / push / merge / migrate / touch-prod / spend-over-$X)
× automation levels (allow / ask / never, in our compressed grammar; the
fuller Sheridan ladder has ten rungs).

**Built.** Nothing. Every gating decision today flows through the same
classifier and the same queue with the same severity defaults. There is no
agent-level policy. There is no capability-level policy.

**Gap, in design terms.** This is the principle whose absence I most felt
when running the fleet — every routine `npm test` failure became a
60-second-cooldown advisory in the queue, demanding a glance-and-dismiss.
Sheridan would say *that whole class of decisions should never have
reached the human in the first place*. The autonomy policy for `npm test`
on a non-merge agent should be "allow"; for an agent about to push to
`main` it should be "ask"; for a migration it should be "ask + GO/NO-GO
ceremony"; for `touch prod` it should be "never".

The *queue* implementation we have is general enough to support this.
What's missing is (a) the policy-attached-to-agent data model, (b) the UI
to express the policy (a literal toggle matrix on the agent detail panel),
(c) the gate logic that consults the policy *before* the classifier fires.

### Endsley — situation awareness pyramid

**Central claim.** Operator situation awareness has three nested levels:
**Perception** of elements in the environment, **Comprehension** of their
meaning, **Projection** of their future state. Most dashboards stop at
Perception (Endsley's words: "data without information"). The scarce skill
is helping operators move up the pyramid.

**Implied UI.** Don't just show what the agents *are doing* (Perception);
show what each agent's behaviour *means* in context (Comprehension), and
forecast what's likely to happen next (Projection). Concretely: not "agent
12 ran npm test, exit 1" but "agent 12 is now in its third validation
loop, this matches a known stuck-on-flaky-test pattern, predicted next
action: ask for human help in 90s".

**Built.** Strong Perception layer (territorial map with multi-channel tile
encoding: state-colour, pressure-height, velocity-bob, halo-heartbeat,
ripple-on-event, decision-pulse). Comprehension partially: the
decision-context block on the session detail panel pins *the relevant
evidence* (failed command + stderr) for the current decision. Projection:
none.

**Gap.** No pattern recognition across an agent's history. We have the raw
event log but no derived "this agent has hit `npm test` 4 times in 8
minutes with the same failure mode" annotation. No projection: "given
current token velocity, agent 12 will hit context limit in ~6 min". The
data is there to compute both. We just don't.

The vision's *situation log* concept (principle 3) is precisely the
Endsley Comprehension layer — durable objects that say "this is a
phenomenon, not a transient event". We built a placeholder, not the real
thing.

### Horvitz — mixed-initiative interfaces

**Central claim.** A 1999 paper that's aged extraordinarily well: when an
automated system might intervene in user work, the design must weigh
**expected utility of action vs. expected cost of interruption**. An agent
should interrupt only when E[value of interrupting] > E[cost of
interrupting], computed from explicit cost-of-interruption models, user
focus state, and task urgency.

**Implied UI.** The cockpit isn't supposed to push notifications at the
human; it's supposed to *be* the notification surface, optimised for
least-cost-glance. But internally, every gating decision is itself an
interruption, with a cost. Horvitz says: *meter that cost*. Some questions
genuinely warrant pausing the human; others can be batched, deferred, or
auto-resolved with a low-confidence default.

**Built.** Severity tiers (info/advisory/required) with cooldowns for
non-required, no cooldown for required. Annunciator + master caution as
two-stage attention grab. These are *good* — they're a coarse cost-aware
escalation. But:

- We don't model the operator's current task or focus state. Spawning an
  agent that hits a destructive-action gate while you're mid-reply on
  another agent's blocking decision should *batch* the new gate behind the
  current one, not interrupt with a fresh annunciator.
- We don't model decision *value*. A `git push --force` to `main` on the
  production deployment branch is a different decision from the same
  command on a test branch — but they fire identical `required` decisions.
- We don't learn from human resolution patterns. If you've approved 47 of
  the last 50 sensitive-path writes for the same project, the 51st should
  probably default-approve with a longer cooldown, not block.

**Gap.** No utility model. The classifier is hard-coded heuristics with no
adaptation. No focus-state input. No batching of low-value interruptions
behind high-value ones.

### Mark / Czerwinski — interruption science, breakpoints

**Central claim.** Mark's CHI 2008 paper showed interrupted work takes
**23 minutes** to fully resume, with measurable cognitive cost. Czerwinski
showed timing matters: interruptions **at task breakpoints** are
substantially less costly than mid-task. So if you must interrupt, time
the interruption to *natural* breakpoints in the operator's flow.

**Implied UI.** The cockpit needs a model of the operator's flow: what are
they currently focused on, where are the natural breakpoints (after
resolving a decision, after closing a detail panel, after returning from
away). Decisions that don't *need* immediate attention should queue
silently and surface only at the operator's next breakpoint. Vision said
the same: "Everything else is summarized at task boundaries (Czerwinski's
breakpoint principle)."

**Built.** Nothing breakpoint-aware. The annunciator pulses immediately on
any required-severity decision regardless of what the operator is doing.
Toasts surface immediately. There's no idle detection, no "operator
returned from away" cue.

**Gap.** No breakpoint model. The cockpit's interrupt model is
"immediately and uniformly". This is exactly what high-decision-flow
operations centres learned NOT to do (ICUs, ATC towers — all use
queueing + per-class deferrability + per-controller mute).

### Pirolli & Card — information foraging / information scent

**Central claim.** Operators forage for information like animals forage
for food: they follow *scent* — perceptual cues that suggest a path will
yield value. UIs that don't surface strong previews force operators to
sample (click in, click back) at high cognitive cost. Strong scent =
fewer dead-end clicks = faster comprehension.

**Implied UI.** Hover previews on every clickable thing. Decision cards
should show enough on the card itself that you don't need to click in. The
outliner should preview the most recent activity per agent. The portfolio
map should give richer signal-per-tile than just colour.

**Built.** This is where the build did relatively well. Decision cards
show the question + command/path + cooldown without expansion. Tiles
encode 6 channels of state. The session detail panel pins the
decision-context block (command + stderr) above the timeline so you don't
have to scroll for the evidence.

**Gap.** Outliner row is text-only, no preview. Hover-preview on tiles is
absent (we removed the basic tooltip in favour of selected-tile-only HTML
floater). Map territories don't preview their hottest agent — you have to
zoom to know what's going on.

### Lee & See — trust in automation, calibration

**Central claim.** Operator trust in automation is empirically calibrated:
shaped by *visible competence history* (success rate, failure mode
predictability) and by *transparency* (why did it do that). Mis-calibrated
trust → either over-reliance (delegating dangerous work to a system you
shouldn't trust that far) or under-reliance (rejecting useful automation
because of one bad incident).

**Implied UI.** Per-agent visible competence history. "This agent has
opened 23 PRs, 18 merged unchanged, 3 merged with edits, 2 abandoned."
"This agent's destructive-action approvals have a 0.95 acceptance rate
across 40 prior decisions." When the operator delegates more autonomy to
an agent, the cockpit should show *what evidence justifies that*.

**Built.** Nothing per-agent in this register. We don't even have a stable
agent identity that persists across sessions — each spawn creates a new
`cockpit_agents` row. There's no track record. The operator has no
calibration data.

**Gap.** Persistent agent identity. Per-agent decision-history rollup.
Per-agent acceptance rate. Per-agent "you have approved X% of N
similar decisions" surfacing on each new decision card.

This is the gap that most directly limits how much autonomy we can
responsibly grant — without competence history, you can't justify a higher
Sheridan rung for any agent.

### Shneiderman — overview first, zoom and filter, details on demand

**Central claim.** The Visual Information Seeking Mantra. Effective
analytical UIs follow this exact sequence: **start with an overview**,
**provide zoom and filter to narrow scope**, **make details available on
demand**. Skipping the overview forces the operator to assemble it
themselves; skipping zoom forces them to scroll-and-search; skipping
details forces them to leave the surface.

**Built.** Strong on overview (territorial map, summary line, queue list).
Zoom: the camera dolly works on selection but no general filter (e.g.
"show only blocked", "show only PULSE", "hide stopped"). Filter:
non-existent. Details: covered (session detail panel + decision-context
block).

**Gap.** No filter at all — outliner shows everything; map shows
everything live; queue shows everything open. With a fleet of 30 agents
across 5 projects you can't filter to "the auth refactor work in PULSE
that's currently blocked". The vision implicitly assumed this through
control groups (number-key bound agent groups, StarCraft-style) — also
unimplemented.

### Weiser & Brown — calm technology, peripheral awareness

**Central claim.** Information should reside at the *periphery* of
attention until it needs the centre. Calm technology lets you know
something is happening without forcing you to look at it. Air-conditioner
hum = calm; phone notification = not calm.

**Built.** This is where the visual work paid off. Halo heartbeat, ripple
rings, tile bob, drift camera — all peripheral signals you absorb without
focusing on. Master caution glow is a deliberately *non-obtrusive* alert
(red inset shadow, not a modal). Sparkline updates in your peripheral
vision in the top bar.

**Gap.** Sound. Real cockpits and ICUs use audio for the most peripheral
awareness — you don't need to look at the panel, you hear when it changes.
We've got nothing audible. Also: no "operator is away" detection. When
the operator returns from being away, there's no way to recap what happened
in their absence (Mark's resumption-cost principle: a recap reduces the 23
min to a few seconds).

---

## The METR sober warning

The vision quoted the METR study explicitly: experienced devs were **19%
slower** with early-2025 AI tools while feeling **20% faster**. The
delta — 39 percentage points of self-deception — is the central
methodological hazard. Any system that *feels good to use* but doesn't
provably help is worse than no system, because it crowds out the
attention that other tools would compete for.

The vision's principle 8 — "measure ourselves" — was the response. It
named the metrics we'd need:

- decisions / hour
- blocked time per agent
- accepted-diff rate
- rework rate
- cost per merged PR
- abandoned sessions
- human decisions per hour

We have *none* of these. We have an events-per-minute sparkline (a
proxy for system activity, not human productivity) and a token-load
readout (a denominator at best). We have the data to compute most of the
list — events table, decision ledger, session lifecycle — but no
aggregations and no UI.

**This is the single most important phase-2 deliverable.** Without it we
literally cannot tell if the cockpit is making things better.

---

## Where the practitioner literature lands

The vision named four lenses. Where they each push:

- **Willison ("parallel coding agents")**: keep agents lightly supervised
  with a small handful per project. Pushes toward *fewer simultaneous
  agents than we're trying to support*. We should be honest that "10+
  agents" was always aspirational; Willison's lived experience suggests
  4-6 is the realistic upper bound for sustained quality.
- **Litt ("code like a surgeon")**: primary vs. secondary task delegation.
  The supervisor stays in the primary task; agents do secondary. Pushes
  toward *making it cheap to delegate, expensive to ignore*. Our
  spawn-modal flow is good; the "ignore agent until they need me" flow is
  good; what's missing is the *handback* flow — when an agent is done,
  reviewing and merging their PR should not require leaving the cockpit.
- **Cherny ("how Boris uses Claude Code")**: 10-15 numbered terminal
  tabs. The realistic baseline. Our cockpit is more sophisticated than
  this but slower for trivial cases. We need a "single agent" path that
  isn't slower than just opening a terminal.
- **Cognition ("Don't Build Multi-Agents")**: context engineering >
  orchestration. Pushes against agent-to-agent coordination, *which the
  vision already absorbed* (principle 7). But also: pushes for
  *deliberate context curation*. We have token-pressure as height — we
  should also surface *what's in context* (what files, what tools, what
  prior turns) and let the operator prune.

---

## What phase 2 should be

Three concrete tracks, in priority order. Each deliberately maps to
multiple framework gaps so we don't end up shipping vanity features.

### Track A: Sheridan + measurement (the load-bearing track)

Without per-capability autonomy and self-measurement, the cockpit is a
nice operating picture and not a productivity claim.

1. **Per-capability autonomy policies** — `cockpit_autonomy_policies` table
   (per agent / per capability / level). UI: a toggle matrix on agent
   detail. Gate logic consults policy *before* classifier. Ten capabilities
   to start: `edit-code`, `push-branch`, `open-pr`, `merge-pr`,
   `run-migration`, `touch-prod-config`, `network-fetch`, `install-package`,
   `spend-over-threshold`, `delete-files`. Three levels: `allow`, `ask`,
   `never`.
2. **Metrics aggregations** — daily rollup of decisions/hour, blocked time
   per agent, accepted-diff rate, abandoned sessions, cost per merged PR.
   Stored in `cockpit_metrics`. Surfaced in a dedicated metrics view
   (Shneiderman: *overview*).
3. **The leading indicator dashboard** — single number, prominently
   displayed: **median decision-queue age**. The vision's chosen leading
   indicator. If it climbs, the cockpit is making things worse.

Estimated work: ~2-3 days. Highest leverage.

### Track B: Endsley Comprehension + Lee & See trust

Promote the cockpit from "what's happening" to "what does this mean and
should you trust it".

1. **Pattern recognition over event history** — when an agent's recent
   events match a known pattern (third-loop-on-same-test, repeating-edit-
   on-same-file, accelerating-token-velocity-suggesting-context-fill,
   stuck-waiting-for-input), emit a *situation*, not just an event. New
   `cockpit_situations` table per the vision. UI: situation log strip
   along the bottom.
2. **Per-agent competence history** — persistent agent identity across
   sessions. Per-agent stats panel: PRs opened, merge rate, edit rate on
   merge, decision approval rate, average review time. Surfaced when the
   operator opens that agent's detail.
3. **Projection** — given current token velocity + history, predict
   "this agent will need decision in N minutes" or "context fill in N
   minutes". A row of forecasts in the summary bar.

Estimated work: ~3-4 days, depends on how far we take pattern detection.

### Track C: Horvitz + Mark/Czerwinski + filter

Make the cockpit *less* interruptive without making it less informative.

1. **Operator focus model** — "what are you doing right now": idle,
   triaging queue, in detail panel, replying. Used to gate when annunciators
   fire vs. queue silently.
2. **Breakpoint detection** — natural breakpoints (just resolved a
   decision, just closed detail panel, returned from idle). Hold non-
   urgent decisions until next breakpoint.
3. **Shneiderman filters** — outliner / queue / map filters: by project,
   by state, by severity, by capability. Saved-filter "scenes" bound to
   keys (vision: principle from Ableton Session View).

Estimated work: ~2-3 days.

---

## Methodology — how we should validate phase 2

The vision's METR warning is direct: *we cannot trust our own sense of
"this feels better"*. Phase 2 needs an evaluation methodology baked into
its delivery.

Three falsifiable claims we should commit to:

1. **The leading indicator falls.** Median decision-queue age before/after
   per-capability autonomy. If autonomy policies are right, fewer
   decisions reach the queue, so age either holds or falls. If age
   rises, we've added bureaucracy not signal.
2. **Time-to-merge for routine PRs is ≤ baseline.** A "trivial PR"
   benchmark (typo fix, docs change, test addition) — does merging
   through the cockpit beat merging by hand? It must, or the cockpit is
   pure overhead for the common case.
3. **Operator can describe their fleet's state without looking.** A
   weekly self-assessment: ask the operator to describe what each agent
   is working on without looking at the cockpit. Compare to ground truth.
   This tests whether the cockpit is building situation awareness or
   just consuming it.

Plus the obvious: **keep the iteration log going**. Each phase-2 cycle
adds to `cockpit-iteration-log.md` with what changed, what was tried,
what was rejected, and against which framework principle.

---

## What to read before phase 2

Worth re-reading with phase-1 hindsight:

- **Endsley (1995)** — the original three-level model paper. The
  *Comprehension* level is where most dashboards die.
- **Horvitz (1999)** — "Principles of Mixed-Initiative User Interfaces"
  CHI paper. The cost-of-interruption decision-theoretic framing is
  exactly what we need for Track C.
- **Lee & See (2004)** — "Trust in Automation: Designing for Appropriate
  Reliance". The competence-history framework justifies Track B item 2.
- **Mark et al. (2008)** — the 23-minute number is widely quoted; the
  paper itself is short and worth the read for the breakpoint nuance.
- **Sheridan, *Telerobotics, Automation, and Human Supervisory Control***
  — for the full ten-rung automation ladder. We're using a
  three-rung compression; might want four or five.

Less directly useful but cited:

- **Czerwinski et al.** on attention switching costs.
- **Pirolli & Card** for information-foraging UI patterns.
- **Weiser & Brown** "Designing Calm Technology" — short, foundational.

---

## What this retro is NOT

- Not a bug list. The implementation has rough edges (the
  detail-panel-vs-queue layout question we never finalised, the outliner
  that's still a duplicate of the map data, the synthetic LOAD readout).
  Those are tactical and tracked elsewhere.
- Not a feature wish list. The framework gaps are the prioritisation
  device, not "what would be cool to add".
- Not a claim that phase 1 was wrong-shaped. The Perception-layer build
  was the right first phase. The visual grammar will carry forward
  unchanged into phase 2. What we're saying is: *Perception is necessary
  but not sufficient*.

---

## Closing thought

The most uncomfortable thing this retro surfaces: **principles 5 (per-
capability autonomy) and 8 (measure ourselves) are the ones that would
make the strongest claim about whether the cockpit works**, and they're
the two we built least of. That's not random. They're the
politically-hardest principles — autonomy means giving up control, and
measurement means risking the answer. The build instinctively avoided
them.

Phase 2 should lead with both.
