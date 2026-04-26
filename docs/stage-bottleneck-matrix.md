# Stage × bottleneck matrix

*Drafted 2026-04-26 in the `ux-audit` worktree, before any UI changes.
This is the spine for the UX audit — it pins down (a) the agent-run
stage model the cockpit needs to support, (b) the four bottlenecks the
operator currently hits, (c) where each bottleneck lives in each stage,
(d) what the operator needs at that point and what today's UI offers.*

*View inventory and per-view critique come later, derived from this.*

---

## TL;DR

The cockpit today implicitly assumes an agent-run is one stage:
**implementation, gated**. State machine values are `queued → orienting →
implementing → validating → blocked / needs-decision / ready-for-review →
merged / stale-zombie`. That's an implementation-centric model.

What's actually true is that real work has at least three stages, and
most of the operator's friction sits *outside* implementation:

| stage          | what it is                                           | UI today                                  |
|----------------|------------------------------------------------------|-------------------------------------------|
| scoping        | "what is the agreed task?" (incl. exploring it)      | spawn modal textarea (one-shot)           |
| implementation | "execute the agreed task with gating"                | full stack — map, queue, detail, hooks    |
| verification   | "agent claims done; is it actually done?"            | nothing structured — falls back to git    |

*An earlier draft split exploration from scoping. Collapsed because
they share the same agent permissions (read-only) and same operator
mode (conversational); the difference is just an intensity gradient
that resolves when the scope artifact is "agreed". One stage, one
surface — the artifact crystallises mid-conversation rather than
between two screens.*

(Two more stages — *PR/CI/review* and *merge/handoff* — exist later in
the workflow. Out of scope for this audit; revisit after we close the
gaps in the three above.)

The four operator-named bottlenecks map onto these stages unevenly:

| bottleneck               | dominant stage         | nature                          |
|--------------------------|------------------------|---------------------------------|
| 1. spawn friction        | scoping                | absent stage, not bad UI        |
| 2. peripheral attention  | implementation         | absent channel, partial today   |
| 3. approval-tax          | implementation         | absent policy data model        |
| 4. decision context      | implementation         | card under-built, panel ok      |

The single biggest lever is bottleneck 1, because the stage it lives in
*does not exist as a first-class concept in the cockpit*. Every other
fix is incremental on a working surface; fixing 1 means **adding a
whole new mode of operation** (read-only investigative agents, scope
artifacts as a first-class object, a structured-conversation surface,
explicit "scope agreed" handoff to implementation).

---

## The stages

### Scoping

**What it is.** Joint exploration + agreement on what the task is.
The agent investigates the problem space (read-only: reads files, runs
inspect commands, asks clarifying questions), the operator steers and
contributes context, and a **scope artifact** crystallises mid-
conversation: a task statement, acceptance criteria, an estimated
touch surface (which files, which capabilities needed), explicit
non-goals, and optionally an autonomy preset for the implementation
that follows. The stage ends when both parties nod and the artifact
gets pushed to "agreed."

**Operator role.** Conversational partner early ("here's what I found
— what's the actual problem?"), reviewer + editor late ("rewrite this
criterion, drop that non-goal, scope agreed"). Same surface, different
intensity at different moments.

**Decisions in this stage.**
- *Direction questions* (early): "pursue approach A or B?", "is this
  worth solving?". Dialogue-shaped, not button-shaped.
- *Artifact approval* (late): "this scope, as drafted, is what we're
  doing." The hand-off to implementation.

These are longer-fuse and more contextual than implementation gating
decisions. They want a chat-shaped surface with a crystallising
document, not a queue card with one-line questions.

**Existence today in the cockpit.** Spawn modal's `brief` textarea —
the entire stage compressed to one freeform paragraph that the
operator drafts alone, with no agent participation, no artifact
structure, no edit affordance, no hand-off. The whole stage happens
in the operator's head; the modal is just where they emit the result.

---

### Implementation

**What it is.** The agent executes the agreed scope. Edits files, runs
tools, gates on destructive/sensitive actions per policy. This is the
classical agent loop and it's what the current cockpit was built
around.

**Operator role.** Supervisor. Watches the live operating picture,
answers gating decisions, intervenes if the agent goes off-scope or
gets stuck.

**Decisions in this stage.** Gating decisions — short-fuse, specific:
"approve `rm -rf node_modules`?", "approve write to `.env`?", "the
test failed, try again or stop?".

**Existence today in the cockpit.** This is the stage we've built. All
six existing components serve it: PortfolioMap, DecisionQueue,
SessionOutliner, SessionDetail, SummaryLine, plus SpawnModal at the
front edge. The hook gating round-trip works end-to-end.

---

### Verification

**What it is.** Agent says "done." Is it? The operator checks: did the
diff achieve the agreed scope, do the tests pass *for the right
reasons*, are there regressions, did the agent silently expand scope
or paper over failures.

**Operator role.** Reviewer + judge. Looks at the diff, the test
output, the agent's own claim, and decides: accept (move to
PR/merge), send back for revision, abandon.

**Decisions in this stage.** "Does the diff match the scope?" "Are
these test results believable?" "Should this go to PR?" Different
shape from gating decisions — slower, more analytical, often
requiring side-by-side comparison.

**Existence today in the cockpit.** Nothing structured. The retro
flagged this as the missing "handback flow." Today the operator falls
back to: read the diff in their editor, run tests by hand, decide
out-of-band. The cockpit doesn't know "verification" is a stage.

---

## The four bottlenecks, located

### Bottleneck 1: spawn friction

> *"defining enough scope for them to get going is slow"*

**Where it lives.** Scoping stage, compressed into a freeform textarea
in the SpawnModal.

**What the operator currently does.** Reads code in their editor or
terminal, forms a mental model alone, drafts a paragraph in `brief`,
presses launch, hopes the agent infers the missing 80%.

**What the operator needs.**
- A way to spawn an agent *into scoping*, not into implementation —
  read-only, conversational, no edits yet.
- A scope artifact (task statement + criteria + non-goals + touch
  surface) that the agent drafts and the operator edits, rather than
  the operator drafting from scratch.
- Explicit hand-off: "scope agreed, begin implementation."
- (Later) a per-scope autonomy preset, so the implementation stage's
  policy is set by the time gating starts.

**What today's UI offers.** SpawnModal: project picker, freeform
textarea, optional callsign + branch. One mode. No scoping
participation by the agent, no scope artifact, no preset.

**Diagnosis.** This isn't a "spawn modal needs more fields" problem.
It's "the cockpit doesn't model the stage where this work actually
happens." Adding fields to the modal is treating the symptom.

---

### Bottleneck 2: peripheral attention — noticing who's waiting

> *"noticing which agents are stuck waiting on a decision"*

**Where it lives.** Implementation stage, between when an agent surfaces
a required-severity decision and when the operator notices.

**What the operator currently does.** Glances at the screen on a polling
cadence ("anyone need me yet?"). For required-severity, the master
caution glow + annunciator help — but only if the operator is looking
at the cockpit at all.

**What the operator needs.**
- Peripheral signal that doesn't require focus on the cockpit window
  (audio? OS-level alert? menubar indicator?).
- *Differential* salience — an agent waiting 4 minutes with nobody else
  waiting deserves more salience than the same agent in a 7-decision
  pile-up.
- Operator-away detection + on-return recap (Mark's resumption-cost
  principle).

**What today's UI offers.** Master caution glow on required decisions.
Annunciator label. Decision card in the queue with cooldown bar
(advisory) or no-expiry (required). PortfolioMap tile state colour and
ripple on event. **No audio. No OS notification path. No away/recap.**

**Diagnosis.** Today's signals work *if you're looking at the screen.*
The bottleneck is the time between "agent is waiting" and "operator
focuses cockpit window," which is exactly what no in-window UI can fix.
Needs an out-of-window channel.

---

### Bottleneck 3: approval-tax on no-decision decisions

> *"spending a lot of time approving decisions that don't really need
> approval"*

**Where it lives.** Implementation stage. Every routine `npm test`
failure, every Bash command the classifier flags, every PreToolUse
event that clears the trigger threshold but isn't actually a judgment
call.

**What the operator currently does.** Glances, identifies as routine,
clicks approve. Or waits for the cooldown to auto-default. Either way,
their attention was spent.

**What the operator needs.**
- Per-capability autonomy policy attached to the agent (Sheridan): for
  *this* agent on *this* scope, `Bash(npm test)` is `allow`; `Bash(rm
  -rf)` is `ask`; `Edit(.env)` is `never`. Most "decisions" never reach
  the queue.
- A way to set those policies cheaply (presets, learn-from-history, per-
  scope at spawn time).
- (Lower priority) cooldown defaults for the residual policy=`ask`
  cases, which is what we already have and what your message
  acknowledged is helping.

**What today's UI offers.** Cooldown defaults (helpful, partial). One
classifier with one severity per trigger across all agents. No agent-
level or scope-level policy.

**Diagnosis.** The cooldown band-aid is on; the underlying cure
(Sheridan per-capability autonomy) isn't built. This is the retro's
Track A item 1 and the highest-leverage *implementation-stage*
intervention.

---

### Bottleneck 4: decision context — "no context for me to make a decision on that"

> *"many were just like 'npm build failed' — no context for me to make
> a decision on that, not even sure what I'm being asked"*

**Where it lives.** Implementation stage. The decision card on the
queue, and to a lesser extent the SessionDetail panel.

**What the operator currently does.** Sees a card with a one-line
question. Has to click through to SessionDetail to see what the agent
was trying, what failed, what the stderr says, what alternatives might
exist. By the time they have enough context, the interruption cost is
already paid.

**What the operator needs.**
- Card-level: enough context to *decide on the card itself.* What was
  the agent trying to accomplish? What command/edit triggered this?
  What's the failure output? What are the natural alternatives (try
  again with `pnpm`? skip the test? change approach?). Pirolli scent.
- Pre-pruned irrelevance: "this is a node_modules permission issue —
  agent is asking if it should retry with pnpm" rather than "Bash
  exit 1."
- For approve: visible "what happens next" so the operator can predict
  consequences.
- For reject: structured options ("retry with X", "skip", "different
  approach") rather than freeform reply when the situation is
  patternable.

**What today's UI offers.** Card shows: question, optional command/
file, severity stripe, cooldown bar. SessionDetail's decision-context
block pins the failed command + stderr above the timeline (that part
is good). **The card itself doesn't pull the context forward; the
classifier doesn't generate context-rich questions; there's no
structured reject-options vocabulary.**

**Diagnosis.** Half-built. The detail panel does the right thing; the
card and the classifier don't. The fix is two-part: smarter classifier
output (richer question text, attached evidence), and a denser card.

---

## Cross-stage observations

### Per-capability autonomy is a stage-aware policy, not a flat one

The Sheridan toggle matrix in the vision is sketched as
"capability × allow/ask/never per agent." But the policy almost
certainly needs to be *stage-aware*:

| capability        | scoping | implementation | verification |
|-------------------|---------|----------------|--------------|
| read files        | allow   | allow          | allow        |
| edit files        | **never** | allow        | never        |
| push branch       | never   | ask            | ask          |
| run tests         | allow   | allow          | allow        |
| run migrations    | never   | ask            | never        |
| destructive       | never   | ask            | never        |

An agent in scoping that tries to edit a file is misbehaving — by
definition it should still be investigating + drafting the artifact.
Stage-attached autonomy catches this for free; capability-only autonomy
doesn't.

### Decision *types* differ per stage

Today the cockpit has one decision shape (the implementation gating
card). But:

- **Scoping decisions** mix dialog ("which approach?") and artifact
  review ("approve this scope as drafted"). Want a chat-shaped surface
  with a crystallising document, not a queue card.
- **Implementation decisions** are gating callouts: short-fuse,
  specific, one-click verbs. The current DecisionQueue card.
- **Verification decisions** are diff/test reviews: side-by-side,
  evidence-heavy, slower-fuse. Want a structured-review surface, not
  a queue card.

If we surface all three through the same DecisionQueue card, we'll
get the implementation card shape forced onto the others — and lose
the affordances each stage needs.

### The verification gap explains a real workflow leak

"Agent claims done" is the moment the cockpit goes silent and the
operator falls back to their editor. Every minute spent there is a
minute the cockpit isn't routing attention. Closing the verification
gap pulls more of the day into the cockpit's purview, which is
prerequisite for any honest "does the cockpit help" measurement.

---

## What this implies for the view inventory (next task)

A first-cut answer to "which views does the cockpit need":

**Stage-agnostic (already exist, mostly right):**
- Portfolio map — the spatial overview of the fleet
- Summary line — the glanceable annunciator + counts
- Session outliner — the per-project hierarchy
- Decision queue — the implementation-decision inbox
- Toasts — ephemeral feedback
- Keymap overlay — discoverability

**Stage-specific (mostly missing):**
- **Scoping surface** — chat + crystallising scope artifact in one
  view. Read-only agent badge, file-reference affordances, no edit
  gating UI. The artifact (task statement, criteria, non-goals, touch
  surface, autonomy preset) fills in mid-conversation; the stage ends
  with a "scope agreed → implement" action that transitions the agent.
  Replaces today's spawn-modal-as-textarea entirely.
- **Verification surface** — diff + test-result view, side-by-side
  with the agreed scope, with accept / send-back / abandon verbs.
- **Autonomy policy editor** — per-agent (or per-scope-preset)
  capability toggles, surfaced at scope-agreement time and editable
  on agent detail.

**Cross-cutting (missing infrastructure):**
- **Away/recap surface** — what happened while you were away.
- **Audio + OS notification channel** — for the peripheral-attention
  bottleneck.
- **Decision card "v2"** — denser, classifier-enriched, structured
  reject options.

**Stage transition mechanism (decided 2026-04-26):**
- Scoping → implementation is a **fresh-context handoff**: scoping
  agent killed, implementation agent spawned with only the agreed
  scope artifact as initial context. Research-backed decision in
  `agent-handoff-decision.md`.

The next deliverable (task #4) will turn this into a per-view
information-hierarchy + interaction-flow document, then mock data
+ snapshots + the React Flow canvas.

---

## Appendix A: alternative workspace models

### GitButler virtual branches — evaluated, deferred

A senior-engineer-running-many-agents alternative to git worktrees:
GitButler keeps **one working directory** and assigns diff hunks to
*virtual branches*, taught to Claude Code via the `but` CLI as a skill.
Multiple agents can work in the same workspace; commits get routed to
the right branches automatically. Trigger.dev and the Maverick blog
post both moved off worktrees specifically for this.

**Pulls toward GitButler.** Worktree disk usage is real (Cursor users
have hit ~10GB in a 20-min session on a 2GB codebase) — and our retro
already flagged worktree accumulation as a known-rough. Worktrees also
require duplicated dev servers / DBs / `node_modules` per branch, and
can produce silent self-conflicts at integration time.

**Pulls against GitButler for *our* setup specifically.**

1. We optimise for **cross-project** parallelism (10+ agents across
   3+ repos). GitButler only helps within-project parallelism — the
   cross-project case still needs separate working directories per
   project regardless.
2. The cockpit's gating semantics assume **per-worktree filesystem
   isolation**. PreToolUse fires on a clean filesystem; "approve this
   `rm -rf`" means "in this isolated workspace." With virtual
   branches the workspace contains a mix of in-flight changes from
   multiple agents — the blast-radius semantics change in ways the
   classifier doesn't currently model.
3. **Real isolation concerns** raised in the GitButler maintainers'
   own discussion (#12228): race conditions when two agents touch
   the same file simultaneously, runtime interference when tests run
   against a workspace mid-edit by another agent, hooks model
   hardwiring one session to one branch.
4. Adopting GitButler adds a **third process** (GitButler app + CLI)
   into a stack already running cockpit-api + claude children, with
   its own hooks model that would either replace ours (loss of
   control) or layer on top (complexity).

**Bottleneck cross-reference.** Does GitButler unblock anything on
our prioritised list?

| bottleneck             | does GitButler help?                              |
|------------------------|---------------------------------------------------|
| 1. spawn friction      | no — same scoping problem either way              |
| 2. peripheral attention| no — orthogonal                                   |
| 3. approval-tax        | no — gating semantics get *harder* in shared ws   |
| 4. decision context    | maybe, but introduces new decision types we don't have today (cross-agent file contention) — net new bottleneck, not a fix for #4 |

**Recommendation.** Defer. The cockpit's `cockpit_workspaces` table
is already an abstraction (worktree OR future container OR ...).
GitButler becomes a third workspace type — `virtual-branch` — when
we choose to add it. The architecture supports this; the gating
logic doesn't yet. Revisit as a deliberate spike *after* shipping
the scoping-stage UX and per-capability autonomy, when the cockpit
is rich enough to gate against a shared workspace coherently.
