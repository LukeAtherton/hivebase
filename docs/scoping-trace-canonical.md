# Canonical scoping-stage trace

*This conversation, the one that produced the UX audit, IS a scoping-
stage workflow. It is annotated here as the canonical test scenario
for any redesign of the scoping surface. If the redesigned UX cannot
support a conversation of this shape, end-to-end, faster than this one
ran in chat, then the redesign has failed.*

*Recorded 2026-04-26 in the `ux-audit` worktree. The conversation took
place between Luke (operator) and Claude (agent) in a Claude Code
terminal session — not yet inside the cockpit. The whole point of
recording it: the cockpit needs to support its own creation.*

---

## What the conversation produced

A scope artifact. It just isn't called that yet — it's split across
three files that all came out of the conversation:

- `docs/stage-bottleneck-matrix.md` — the conceptual spine
- `docs/scoping-trace-canonical.md` — this file
- The next deliverable (task #4) — per-view information hierarchy

If the cockpit had a scoping surface, the artifact would have been
*one document*, drafted live by the agent, edited live by the
operator, agreed at the end, and pushed to implementation as the
brief for one or more agents. Not three retrospective markdown files.

---

## The arc

Eight numbered turns, each representing a real shift in the
conversation. Each entry: what stage-shaped activity happened, what
decisions surfaced (explicit or implicit), what the cockpit *would*
have rendered, and what was missing.

### Turn 1 — operator-loaded cold-pickup brief

Operator pasted the cold-pickup prompt: read these four docs, summarise
state, propose a phase-2 track, propose a smallest first step.

**Stage-shaped activity:** scoping, intake. The operator was loading
context into the agent.
**Decisions surfaced:** none yet — the agent was being commissioned.
**Cockpit today:** the SpawnModal `brief` textarea is the closest
analog. The operator would have pasted this whole prompt into the
textarea and pressed launch.
**Cockpit gap:** the operator explicitly named four documents to read
*in order*, with optional fifth. The cockpit has no concept of
"context-loading instructions" — those would be lost in the brief.
The cockpit also has no concept of the intake response shape: "(a)
state, (b) chosen track, (c) smallest first step." If this had been
spawned via the modal, the agent would have had no idea those were
the deliverables.

### Turn 2 — agent reads, summarises, recommends

Agent read all four docs in parallel, summarised state, recommended
Track A, proposed leading-indicator as first step.

**Stage-shaped activity:** scoping. The agent investigated (read-only)
and proposed a scope.
**Decisions surfaced:**
- *Implicit:* "Track A or B or C?" The agent picked A and justified.
- *Implicit:* "What's the first step within Track A?" The agent
  proposed the leading indicator.
**Cockpit today:** would have rendered these as a wall of text in
SessionDetail. No artifact, no structure, no "agent has proposed a
scope, do you approve?" affordance.
**Cockpit gap:** the *recommendation* was the most important output of
this turn, but it was buried in prose. A scoping surface would extract
it: "Proposed track: A. Proposed first step: leading indicator."
Operator could agree, edit, or send back without scrolling.

### Turn 3 — operator pushes back on framing

Operator said: "I'm very skeptical of the METR results." Reframed the
goal from loss-prevention to throughput-ceiling-raising. Provided new
context the agent couldn't have inferred (current 10× baseline,
goal of pushing further).

**Stage-shaped activity:** scoping. Pure operator-context-injection
that *invalidated the agent's prior reasoning*. This is the
"correction during scoping" pattern.
**Decisions surfaced:**
- *Explicit:* the framing of the goal itself — "not measurement
  hedge, throughput ceiling."
- *Implicit:* the leading indicator drops in priority.
**Cockpit today:** would render as another transcript message. The
fact that *the prior turn's recommendations are now invalidated*
would not be surfaced anywhere — they'd just sit there, looking
agreed-to.
**Cockpit gap:** when the operator injects context that invalidates
the proposed scope, the artifact should *visibly become stale* —
prior recommendations greyed out or marked "needs revision." Without
this, the operator has to remember which earlier proposals are now
moot.

### Turn 4 — agent re-reasons with new framing

Agent revised the plan: demoted measurement, re-elevated Sheridan,
rewrote the falsifiability criteria, asked one clarifying question
(rough target for the ceiling raise).

**Stage-shaped activity:** scoping. Agent updated the artifact and
asked a follow-up to disambiguate.
**Decisions surfaced:**
- *Implicit:* the entire plan changed shape. The agent ran most of
  the artifact through a rewrite.
- *Explicit:* "10 → 15 vs 10 → 30?" — a direction question that
  shapes everything downstream.
**Cockpit today:** would render as another wall of text. The
clarifying question would not be flagged as a *blocking question* —
it would just be a paragraph the operator might or might not notice.
**Cockpit gap:** scoping decisions *can* be blocking ("can't proceed
without your answer to X") but they're not gating-decision-shaped.
The cockpit's only blocking-decision UI is the implementation
DecisionQueue card with one-line questions. A scoping question like
"10 → 15 or 10 → 30?" needs a different surface — multi-option, with
context, with the implication of each option spelled out.

### Turn 5 — operator answers with bottleneck enumeration

Operator named four concrete bottlenecks (spawn friction, peripheral
attention, approval-tax, decision context) plus a meta-observation
(decision cards lack context).

**Stage-shaped activity:** scoping. Operator-context-injection again,
this time *enumerative* rather than corrective.
**Decisions surfaced:**
- *Implicit:* the agent's "10 → 15 vs 10 → 30" question got answered
  obliquely — the bottlenecks themselves *are* the answer.
- *Implicit:* the priority order of phase-2 work was set by the
  bottlenecks themselves.
**Cockpit today:** wall-of-text rendering. The structured information
(four bottlenecks, with examples each) would not become a structured
artifact anywhere.
**Cockpit gap:** when the operator emits structured information in
prose, the agent should extract it into the artifact (as a list of
named bottlenecks with examples) and render it inline. The operator
shouldn't have to re-state structure that's already in their message.

### Turn 6 — agent replays the bottlenecks, re-prioritises, asks clarifiers

Agent played back the four bottlenecks, ranked them, sketched a
revised plan, and asked two clarifying questions (mock data realism,
spawn redesign scope).

**Stage-shaped activity:** scoping. Convergence — the artifact is
starting to firm up. The clarifying questions are about *implementation
detail*, not framing.
**Decisions surfaced:**
- *Explicit:* the priority order (1 > 4 > 3 > 2) was proposed.
- *Explicit:* two specific clarifying questions were posed.
**Cockpit today:** wall of text. The two questions would not be
flagged as parallel/independent (they could be answered in either
order or simultaneously).
**Cockpit gap:** the scoping surface should distinguish between
*sequential* clarifying questions (each depends on the previous) and
*parallel* ones. It should also flag *which proposals in the artifact
are firm vs. tentative-pending-clarification*.

### Turn 7 — operator reframes scope using the conversation itself as data

Operator made the meta-move: "we can create mock data from THIS
conversation right? we're doing the work right now in this chat."
Plus: "should we move this chat on platform?" Plus: "we may be missing
some defined workflows like exploration vs scoping vs implementation
vs verification."

**Stage-shaped activity:** scoping. The operator *expanded the scope*
by introducing a new concept (stages of an agent run) and a
self-referential dogfooding observation.
**Decisions surfaced:**
- *Explicit:* "should we dogfood this conversation by moving it on
  platform?"
- *Implicit:* "the stage model is missing from the matrix."
**Cockpit today:** wall of text. The new concept (stages) would just
become more text, not a *first-class addition to the artifact*.
**Cockpit gap:** when a scoping conversation introduces a structural
concept that should reshape the artifact (stages → reshape the whole
matrix), the agent needs to recognise this and propose an artifact
restructuring, not just keep talking.

### Turn 8 — agent absorbs, re-restructures, asks the stage-distinction question

Agent absorbed the dogfooding question (recommended deferring), agreed
the stages were missing, sketched the four-stage model, and asked
*was exploration vs scoping deliberate or riffing?*

**Stage-shaped activity:** scoping. Convergence again, with one more
clarifying question on the structural addition.
**Decisions surfaced:**
- *Explicit:* dogfooding deferred — "keep this conversation here,
  archive it as a workflow trace."
- *Explicit:* stages added to the model.
- *Explicit:* one more open question on stage granularity.
**Cockpit today:** wall of text. (You see the pattern.)
**Cockpit gap:** by this point the artifact has gone through six
revisions and the operator has no easy way to see the *delta from
the original* without re-reading every turn. A scoping surface should
maintain a *single living artifact* with version history, not a chat
log that retroactively rewrites prior conclusions.

### Turn 9 — operator confirms, defers verification + PR/CI

Operator: "I was riffing, I think you're intuition is correct. Tbh
verification is another stage that takes a lot of time and we also
have the stage of raising a PR and going through CI and review etc
near the end of the process. This is less of a concern now but
something to consider down the track."

**Stage-shaped activity:** scoping. *Almost-agreement.* Operator
confirmed the stage merge, added two more stages (verification, PR/CI)
and explicitly deferred them.
**Decisions surfaced:**
- *Explicit:* exploration + scoping collapse into one stage.
- *Explicit:* verification is its own stage, in scope.
- *Explicit:* PR/CI/review is a stage but *out of scope for this audit.*
**Cockpit gap:** explicit scope-deferral ("X is real but out of scope")
is a first-class concept. The artifact's "non-goals" field exists for
this. Today it would just be more prose.

### Turn 10 — operator says "let's go"

Operator: "Let's go." Implicit "scope agreed, begin implementation."

**Stage-shaped activity:** stage transition. **Scoping → implementation.**
**Cockpit today:** there is no transition. The implementation has been
happening throughout (we created the worktree, started the app,
rebranded). This is because the cockpit doesn't model the stages —
the agent is doing both at once.
**Cockpit gap:** the scoping → implementation transition should be a
deliberate, visible event in the cockpit. "Scope agreed, agent (or
new agent) begins implementing per this artifact." The artifact
becomes immutable; the implementation is held to it.

### Turn 11 — operator reframes mid-execution: "let's also rebrand"

Operator: "great, let's do it in a worktree, let's also start the
app. Another direction I would like to take is a review of our
UI/UX..."

Then later: "let's keep moving."

Then: "ok great, one other thing to throw into the mix..."

**Stage-shaped activity:** **mid-implementation scope expansion.**
Operator added new requirements while the agent was already executing
on the agreed scope.
**Decisions surfaced:**
- *Explicit:* expand scope to include UX audit (turn 11a).
- *Explicit:* rebrand hivebase → kybernos (turn 11b — much later).
- *Explicit:* evaluate GitButler (turn 11c — later still).
**Cockpit gap:** scope-expansion-during-implementation is a real
pattern. The artifact needs to support edits *after* the scoping →
implementation transition, with a clear "this is a scope change, do
you want to:" affordance — restart, accept-as-extension, defer to a
follow-up agent. The cockpit has nothing for this today.

---

## Patterns the cockpit must support

Pulled out of the trace, these are the *minimum viable* affordances
of any redesigned scoping surface:

1. **Context-loading instructions, not just a brief.** "Read these
   files in this order" is a first-class input separate from the task
   description.
2. **Structured deliverable shape.** "Respond with (a), (b), (c)."
   The agent should know what shape the answer should take and the
   cockpit should render it in that shape.
3. **Operator-context-injection that visibly invalidates prior agent
   reasoning.** Stale proposals should be greyed/struck-through
   automatically when the framing changes.
4. **Multi-option scoping questions** (different shape from
   one-line gating questions). "10 → 15 or 10 → 30?" with the
   implications of each spelled out.
5. **Structured-information extraction from operator prose.** When
   the operator types a list, the artifact gets a list — not a
   paragraph that the operator must re-state.
6. **Sequential vs parallel clarifying questions.** Distinguish in
   the UI.
7. **Scope-restructuring proposals.** When a turn introduces a
   structural concept (stages), the agent should propose reshaping
   the artifact, not just keep talking.
8. **Living artifact with version history.** Six revisions of the
   matrix happened; there's no easy "diff from start" view.
9. **Explicit scope deferral.** First-class non-goals.
10. **Visible scope-agreed transition.** "Implement per this
    artifact" as a deliberate event.
11. **Scope-expansion-during-implementation.** Affordance for
    operator to add scope mid-flight, with clear options
    (restart / accept-as-extension / defer-to-follow-up).

---

## What this trace says about the existing SpawnModal

The SpawnModal supports *exactly one* of these patterns (a freeform
brief, which is a degenerate version of #1 + #2 combined). Patterns
3-11 are entirely absent.

This is the empirical version of the matrix's claim: "this isn't a
spawn modal needs more fields problem, it's a stages-aren't-modelled
problem." The trace makes it concrete — eleven patterns, one of
which is supported.

---

## Use as test scenario

When the scoping surface exists in some form, replay this conversation
through it (manually or via mock data seeded from these turns) and
ask: would each turn have been *easier* in the new surface than it
was in chat? Where would the operator have spent less time
restating context? Where would the agent have proposed structure
instead of waiting for the operator to ask?

If the answer to "easier" isn't "yes, materially" — the redesign
hasn't earned its complexity.
