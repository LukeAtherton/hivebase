# Agent handoff decision: scoping → implementation

*Decided 2026-04-26 in the `ux-audit` worktree, based on research
synthesis. Recorded here so a future cold-pickup doesn't re-litigate.*

---

## The decision

When the operator clicks **agree** in the scoping surface, the cockpit:

1. Marks the scope artifact immutable.
2. Stops the scoping agent (kills the child process; ledger entry).
3. Spawns a *fresh* `claude` CLI child in the worktree with **only the
   scope artifact as initial context** — no scoping transcript, no
   exploration discoveries beyond what made it into the artifact, no
   operator-correction history.
4. The new agent starts in implementation stage with a clean context
   window, the artifact as its initial user message, and the agent-
   level autonomy policy already attached.

**Implementation runs in a fresh context.** Not a continuation of the
scoping session.

---

## Why (research-backed, not vibes)

The community and the producers of these tools have converged on the
research/plan/implement-as-separate-contexts pattern. Multiple
independent sources, multiple independent reasons:

### 1. Anthropic's official position

[Effective Context Engineering for AI
Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
names *context resets* — clearing the window entirely and starting a
fresh agent with a structured handoff artifact — as a primary
mechanism for long-running work. Not a fallback.

### 2. Anthropic's three-agent harness for multi-hour autonomous coding

[InfoQ writeup of the three-agent harness](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/)
documents Anthropic's own production-grade pattern: **planner**,
**generator**, **evaluator** — three separate contexts, with handoff
artifacts carrying state between them. This is the architecture
behind their multi-hour full-stack app generation work, not a toy.

### 3. Cognition's "Don't Build Multi-Agents" — read-vs-write task split

[Cognition's blog post](https://cognition.ai/blog/dont-build-multi-agents)
is anti-uncoordinated-multi-agent, but explicitly endorses fresh
contexts with careful handoffs. Their key distinction: **read-heavy
tasks parallelise well; write-heavy tasks have coordination problems
when parallelised**. Scoping is read-heavy (investigation, dialogue);
implementation is write-heavy (file edits with side effects).
Different stages → different contexts is consistent with their
framing.

### 4. Claude Code's own default behaviour

Claude Code clears context at the end of plan mode by default —
this is a recent design decision in the same direction. The product
team responsible for the tool we run has shipped this opinion in
prod.

### 5. Empirical context-rot finding

Multiple sources ([Mind Studio context-rot
explainer](https://www.mindstudio.ai/blog/what-is-context-rot-ai-agents),
[Will Ness](https://willness.dev/blog/one-session-per-task), [Rich
Snapp](https://www.richsnapp.com/article/2025/10-05-context-management-with-subagents-in-claude-code))
report the same failure mode: long contexts push attention away from
what currently matters. Implementation agents that retain the entire
scoping conversation perform measurably worse than fresh
implementation agents that only see the agreed artifact.

### 6. Community convergence

Independent practitioners ([Armin Ronacher on plan
mode](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/), Geoff
Litt's "code like a surgeon," the [open Claude Code issue
#32916](https://github.com/anthropics/claude-code/issues/32916) on
plan-to-implementation handoff) have all landed on
research/plan/implement-as-separate-windows.

---

## What this implies for the cockpit

### The scope artifact is load-bearing in a way that a chat summary isn't

It's not just "a nice document for the operator." It's the **entire
context** the implementation agent will have. Every field the
operator omits is information the implementation agent will lack.
Every citation that lives in chat but not in the artifact is a fact
the implementation agent never sees.

This pushes several artifact fields up the priority list:

- **Touch surface auto-detection** — `P1 → P0`. The implementation
  agent needs to know which files are in scope without re-discovering
  them.
- **Acceptance criteria** — must be specific and testable. They're the
  implementation agent's success spec, not just the operator's
  checklist.
- **Non-goals** — critical. Without them, the implementation agent
  may re-litigate decisions you settled in scoping.
- **Citations from scoping** — file references, prior-art notes,
  "we tried X last quarter" context — must be captured *into* the
  artifact, not just left in the chat.

The scope artifact is closer to a **PRD or spec** than to a chat
summary. The chat is the mechanism by which it gets drafted; the
artifact is the output that survives the context boundary.

### The autonomy policy goes with the artifact

The agent-level autonomy policy decided during scoping must also
travel across the boundary as part of the agreement. It can't live
only in the cockpit-api's mind — it should be referenced in the
artifact for traceability ("this implementation runs at the
'sandboxed' preset, with these overrides").

---

## Open secondary questions, with provisional answers

### 1. Same model for scoping vs implementation?

Anthropic's three-agent harness uses different model configs (Opus
for planner, Sonnet for generator). With our subscription-billed CLI,
both are `claude` — but we may want different *modes*: scoping in a
"think aloud, explain reasoning" posture, implementation in an
"execute focused" posture.

**Provisional:** same model (claude), different system-prompt-ish
hint at spawn time. Defer the cross-model split until the SDK adapter
work returns.

### 2. Implementation agent sees verbatim artifact, or generated brief?

- **Verbatim:** artifact rendered as the agent's initial user message,
  agent infers what to do.
- **Generated brief:** the cockpit (or a final scoping-agent step)
  writes a focused prompt from the artifact, agent sees only the
  prompt.

**Provisional: verbatim.** Honest, the artifact has a known structure,
the agent is fluent at reading PRDs. Refine to generated-brief later
only if context bloat shows up empirically.

### 3. What happens to the scoping agent after handoff?

- *Killed* — cleanest, no risk of operator addressing the wrong
  agent.
- *Kept alive* — useful if implementation agent surfaces a "wait,
  what did you mean by X?".
- *Archived as queryable transcript* — forensic value, no live agent.

**Provisional: killed.** Re-spawn a scoping agent if clarification is
needed. Simpler mental model. The transcript is persisted in the
session/event tables regardless.

### 4. What if the operator wants to expand scope mid-implementation?

This is the trace's pattern #11 ("scope-expansion-during-
implementation"). Three options when triggered:

- **Send back** — implementation agent is killed, fresh scoping agent
  spawned with the existing artifact pre-loaded as starting point.
- **Accept-as-extension** — artifact is amended, implementation agent
  is sent the diff as a follow-up user message (no kill).
- **Defer-to-follow-up** — current implementation continues, a new
  scope artifact is drafted for the extension, spawning a second
  implementation agent.

**Provisional:** support all three. UI surface in the scope artifact
panel labelled "scope change?" with the three options spelled out.

### 5. What if implementation agent disagrees with the artifact?

The implementation agent might, mid-execution, surface "the artifact
says do X but I think Y is better." This is *not* a gating decision
— it's a scope question.

**Provisional:** route to a special decision card type
("scope-question") that surfaces in the queue with the option to
**send back to scoping** (re-open the scoping surface with the
question pre-loaded) or **insist on artifact** (instruct
implementation agent to proceed as written).

---

## What to verify after building

The decision is research-backed, but our specific stack might surprise
us. Worth measuring once the scoping surface ships:

- **Implementation agent quality with fresh context vs. continued
  context.** Run the same task both ways for N tasks; compare
  acceptance rate, rework rate, time-to-completion.
- **Artifact completeness.** What fraction of implementation-stage
  scope-questions trace back to information that *was* in the
  scoping conversation but *not* in the artifact? If high, the
  artifact-extraction step needs work.
- **Operator effort to draft an artifact-quality scope.** If
  artifact-driven scoping is much slower than today's spawn modal
  for trivial tasks, we need a fast-path for them (skip scoping for
  one-line tasks).

These are the metrics that would *falsify* the decision if it turned
out wrong for our setup.

---

## Sources

Consolidated for easy scanning. Each is also linked inline above
where the relevant point is made.

**Producer-side (Anthropic):**
- [Effective Context Engineering for AI Agents — Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Harness design for long-running apps — Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Anthropic Designs Three-Agent Harness for Long-Running Full-Stack AI Development — InfoQ writeup](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/)
- [Best practice for plan-to-implementation context handoff across /clear? — claude-code issue #32916](https://github.com/anthropics/claude-code/issues/32916)

**Producer-side (others):**
- [Don't Build Multi-Agents — Cognition](https://cognition.ai/blog/dont-build-multi-agents)

**Practitioner / community convergence:**
- [What Actually Is Claude Code's Plan Mode? — Armin Ronacher](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/)
- [Why You Need To Clear Your Coding Agent's Context Window — Will Ness](https://willness.dev/blog/one-session-per-task)
- [Context Management with Subagents in Claude Code — Rich Snapp](https://www.richsnapp.com/article/2025/10-05-context-management-with-subagents-in-claude-code)
- [What Is Context Rot in AI Agents — MindStudio](https://www.mindstudio.ai/blog/what-is-context-rot-ai-agents)

**Last verified:** 2026-04-26. Recheck if revisiting this decision —
the field is moving fast and consensus could shift.
