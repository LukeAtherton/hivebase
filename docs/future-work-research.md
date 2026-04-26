# Future-work research notes

*Drafted 2026-04-26 in the `ux-audit` worktree. Things we don't need to
decide right now, but that come up often enough that we want the
research recorded with the question, not chased again the next time
we mention them.*

*Each section: the question, what the research says, the design
implications, the tension worth being aware of, sources. Update if
the field moves.*

---

## 1. Cross-model verification — should the verification agent be a different model?

**Question.** Operator hypothesis: the verification-stage agent could
be a different model (e.g., Codex/GPT/Gemini reviewing Claude Code's
output) for adversarial diversity. Worth doing?

**What the research says.**

- **The core finding is strongly in favour of model diversity for
  verification, and against it for collaborative implementation.**
  Two distinct mechanisms.

- **Pro-diversity: same-distribution review is degenerate.** A
  Verilog code-generation study found that erroneous outputs from a
  first agent were accepted downstream because the agents *shared the
  same training distribution and lacked adversarial diversity*.
  Single-agent self-review degenerated into repeating the original
  errors. Same-family review (e.g., Claude reviewing Claude) shows
  the same pattern.

- **Adversarial-pair improves quality measurably.** SPC (Self-Play
  Critic) and RLAC research show that adversarially-trained
  generator/critic pairs produce real benchmark gains — Qwen Solver
  on MATH500 went from 16.7% → 23.3% accuracy with adversarial
  critic. RLAC reached high performance with 5.7× fewer
  verification calls than alternatives. **The gain is precisely
  because the critic is structurally different from the generator.**

- **Counter-intuitive: heterogeneous teams underperform their best
  member.** A 2026 paper (referenced in the heterogeneous-coding-
  agents survey) found heterogeneous multi-agent teams consistently
  failed to match their best individual member, with performance
  losses up to 37.6%, *even when explicitly told which member was the
  expert.* The failure mechanism was consensus-seeking: agents drifted
  toward agreement instead of holding the expert's position. Worse
  with homogeneous copies.

- **Different-model coding agents have real reproducibility
  variance.** Empirical study of Claude Code, OpenAI Codex, and
  Gemini found only 68.3% of generated projects executed out-of-the-
  box, with high cross-language variance (Python 89%, Java 44%). So
  *outputs* differ — which is good for adversarial diversity, but
  bad if the verification agent is from a model family worse at the
  specific language than the generator.

**Design implication for our cockpit.**

- **Verification stage is a strong candidate for cross-model.** The
  task there is genuinely "find what the generator missed." Same-
  model review is empirically degenerate; cross-model is empirically
  better.
- **Implementation stage should NOT be heterogeneous-team-style.**
  We're not running 3 agents and asking them to vote. The cockpit's
  whole architecture is single-agent-per-session. Don't add
  "consensus" to implementation just because the research mentions
  ensembles.
- **The cross-model verification path requires the SDK adapter, not
  the CLI.** Codex/Gemini don't have a `claude` CLI equivalent in
  our setup. SDK adapter (already in the codebase, deliberately
  preserved per `COCKPIT_PLAN.md`) becomes load-bearing for this.
- **Pair the critic with the generator's output language.** Don't
  use a model that's worse at Java to verify Java code regardless
  of how diverse it is.

**Tension to be aware of.** Subscription billing (`claude /login`)
covers the implementation agent for free. Verification via Codex/
Gemini lives outside that — it's API-billed against whatever key
we configure. Cost will *show up* the moment we wire this. May be
fine for verification (lower frequency than implementation), but
worth measuring.

**Open questions worth answering when we get to it.**

- Does cross-model verification actually catch more issues than
  same-model verification *on our specific code-base distribution*?
  (Run N tasks both ways, compare false-pass rate.)
- Where in the verification flow does the cross-model agent
  participate — automated pre-screen, or operator-invoked second
  opinion? Different UX shapes.
- If the cross-model critic disagrees with the generator, who wins?
  (Lee & See trust calibration on cross-model decisions is its own
  problem.)

**Sources.**

- [Cross-Verification Collaboration Protocol (CVCP) — MDPI Symmetry](https://www.mdpi.com/2073-8994/17/10/1660)
- [SPC: Evolving Self-Play Critic via Adversarial Games for LLM Reasoning (arXiv 2504.19162)](https://arxiv.org/pdf/2504.19162)
- [RLAC: Reinforcement Learning with Adversarial Critic for Free-Form Generation Tasks](https://liner.com/review/rlac-reinforcement-learning-with-adversarial-critic-for-freeform-generation-tasks)
- [AI-Generated Code Is Not Reproducible (Yet): Empirical Study of LLM-Based Coding Agents (arXiv 2512.22387)](https://arxiv.org/html/2512.22387) — three-model reproducibility comparison
- [A Survey on Code Generation with LLM-based Agents (arXiv 2508.00083)](https://arxiv.org/html/2508.00083v1) — heterogeneous-team underperformance finding
- [LLM Code Reviewers Are Harder to Fool Than You Think (arXiv 2602.16741)](https://arxiv.org/html/2602.16741v1)

---

## 2. Same-project agent communication — do parallel agents need to talk?

**Question.** Operator hypothesis: agents working on the same project
need some way to communicate — message-board style, or Redis. Worth
designing?

**What the research says.**

- **There's a clear winner pattern: artifact-based handoff, not
  direct messaging.** Multiple sources converge on this. From Google
  Developers' multi-agent framework writeup:
  > *"Multiple agents working on the same task should not communicate
  > via sharing memory; instead, agents should communicate through
  > minimal, structured outputs in a controlled manner. Communication
  > should be treated not as shared memory, but as state transfer
  > through well-defined interfaces."*

- **Token-efficiency numbers are large.** Scope-isolated artifact
  handoffs cut per-request token consumption by **60–70%** vs. a
  monolithic-context approach. Latency drops to **<200ms per
  handoff** when using structured objects rather than full
  conversation history.

- **The blackboard pattern is the sophisticated case.** Recent
  papers (including a 2026 ACL paper on LLM-Based Multi-Agent
  Blackboard System for information discovery) demonstrate strong
  results: agents independently monitor a shared knowledge base,
  contribute when they have value to add, agent selection emerges
  from current blackboard state. This is *real* shared-memory
  multi-agent coordination, and it works — but it's structurally
  different from "Slack for agents."

- **Redis is the standard infrastructure for this when you do need
  it.** Redis Streams + pub/sub handle event sourcing, task queues,
  shared memory, and asynchronous notification natively. We already
  have Redis in our stack (cooldown scheduler uses it).

- **The dominant failure mode of multi-agent systems is
  coordination, not capability.** Multiple sources converge here.
  Cognition's "Don't Build Multi-Agents" warns specifically about
  the mess. The blackboard papers note that even well-designed
  shared-memory systems suffer from agents talking past each other
  when goals aren't tightly scoped.

**Design implication for our cockpit.**

The honest answer depends on *what kind of communication* we're
talking about. There are at least three distinct cases:

| Case | What it is | Right pattern |
|------|------------|---------------|
| **Sequential handoff** | Scoping → implementation → verification, one agent's output is the next agent's input | **Artifact-based, no direct messaging.** This is the decision we already made (`agent-handoff-decision.md`). |
| **Same-stage parallel work** | Two implementation agents both working on different parts of the same project | **Artifact / blackboard, with operator as orchestrator.** Agents read each other's *committed* output via git, not their *in-progress* state. Operator routes scope to keep them out of each other's way. |
| **Real-time coordination** | Agent A is editing a file Agent B is about to read | **Detection + decision, not communication.** This is a *cockpit responsibility*, not an agent-to-agent message. The cockpit notices the contention and surfaces it as a decision (see GitButler appendix in `stage-bottleneck-matrix.md`). |

**Worth being explicit:** *"agents communicate"* is a tempting framing
that's almost always wrong. What we actually want is:

1. **Agents read shared committed state via git.** This already works.
2. **Agents write artifacts the cockpit captures and routes.** This
   is the scoping-artifact pattern, generalised. Could also include
   verification reports, situation entries, etc.
3. **The cockpit detects cross-agent contention and surfaces it to
   the operator as a decision.** Single source of routing.

We almost certainly *don't* want a generic "agents post to a Redis
message board." That's the failure mode the research warns about.

**What we might actually want, when we get there.**

- A **situation log** as a shared blackboard — but written *by the
  cockpit* on behalf of agents, not by agents directly. Each long-
  running problem has one entry; agents hitting the same problem
  add evidence; operator sees one situation, not N events. (Vision
  principle 3, mostly unbuilt — see `phase-1-retro.md`.)
- A **scope-overlap detector** in the cockpit that watches the
  agreed-scope `touch surface` field across all live sessions and
  flags when two agents claim overlapping files. Decision card to
  the operator: "scope conflict, A or B?". This is the cockpit's
  role, not an agent's.

**Tension to be aware of.** The blackboard pattern *is* a real,
research-backed thing — and the situation log might genuinely want
to be one. The line between "useful shared blackboard" and "noisy
message bus that ruins coordination" is exactly the kind of thing
that's easy to get wrong. If we go this route, the discipline is:

- Only the cockpit writes to the blackboard.
- The blackboard contains *durable problem objects with lifecycle*,
  not transient messages.
- Agents read, but don't write directly.
- Operator is the only entity that can resolve a situation.

**Open questions worth answering when we get to it.**

- Does the situation log warrant Redis pub/sub for live updates, or
  is the existing Postgres-backed event firehose enough? (We have
  a WS broadcast already; Redis would matter at much larger fleet
  scale.)
- Should agents be able to *query* the situation log
  (read-only), e.g. "is anyone else hitting this same test
  failure?" Yes, probably — it's information foraging (Pirolli)
  applied to agent context.
- How do we surface situation-log discovery in the agent's prompt
  *without* polluting context? (Maybe: the cockpit injects only
  *relevant* situations as tool-call results when the agent
  searches for them.)

**Sources.**

- [How we built our multi-agent research system — Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Multi-agent systems: Why coordinated AI beats going solo — Redis](https://redis.io/blog/multi-agent-systems-coordinated-ai/)
- [Why Multi-Agent LLM Systems Fail & How to Fix Them — Redis](https://redis.io/blog/why-multi-agent-llm-systems-fail/)
- [Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture (arXiv 2507.01701)](https://arxiv.org/html/2507.01701v1)
- [LLM-Based Multi-Agent Blackboard System for Information Discovery in Data Science (arXiv 2510.01285)](https://arxiv.org/abs/2510.01285)
- [Memory in LLM-based Multi-agent Systems: Mechanisms, Challenges, and Collective (TechRxiv survey)](https://www.techrxiv.org/users/1007269/articles/1367390/master/file/data/LLM_MAS_Memory_Survey_preprint_/LLM_MAS_Memory_Survey_preprint_.pdf?inline=true)
- [Architecting efficient context-aware multi-agent framework for production — Google Developers](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/)
- [Don't Build Multi-Agents — Cognition](https://cognition.ai/blog/dont-build-multi-agents)

---

## 3. Live-progress display — agent "exhaust trail" + mid-execution review

**Question.** Operator hypothesis: the cockpit currently shows agent
progress as a *pulse animation* (size/heartbeat) which is more
distracting than informative. A more honest display would be a
**train running along a track with artifacts dropping out the back**:
each tool call deposits a small object whose size/colour/shape
encodes what kind of artifact it is and how big the change is. Click
to expand into a real diff view (GitHub-style). Comment inline as the
agent works; comments visible to the agent in its next tool call as
a control loop.

This is *concurrent supervision* — reviewing as work happens, not
waiting until the end.

**What the research says.**

- **There's an active, fast-moving research line on exactly this.**
  CHI 2025 paper *Interactive Debugging and Steering of Multi-Agent
  AI Systems* (AGDebugger) is the canonical academic work — already
  cited in our `VISION.md`. Its three primitives map almost exactly
  onto your idea: (a) interactive viewer of messages exchanged
  between agents, (b) ability to send *new messages* during a run
  without stopping the agent, (c) ability to reset to an earlier
  point and edit. Pause-and-resume + mid-run injection is the
  pattern.

- **Microsoft VS Code has an open feature request for "Live
  Steering"** (issue #288920) calling for *"asynchronous steering
  notes — users can input guidance that agents check between tool
  calls without needing to be stopped and restarted."* This is your
  proposal, almost word-for-word. The fact that the request is
  *open* and not shipped tells you nobody has built the polished
  version yet.

- **Streaming infrastructure exists in every modern agent SDK.**
  OpenAI Agents SDK, AI SDK Artifacts (`useArtifact` hook with
  update / completion / progress callbacks), CrewAI Flows, Claude
  Agent SDK partial-message events, oh-my-pi terminal agent. The
  *pipe* for streaming tool-call results into a UI is solved —
  what nobody has solved is the *visual grammar* for displaying
  it well.

- **VS Code extensions are starting to attempt visual displays.**
  Damocles renders inline diff previews per tool call with
  click-to-expand to a full panel. Event Horizon visualises agent
  activity as a "living cosmic system." Both are early.

- **Closed-loop human ↔ agent feedback is empirically validated.**
  VF-Coder's visual-feedback framework establishes a closed loop of
  "visual perception → dynamic interaction → code refactoring" with
  measurable repair gains. The principle that *the human's
  in-flight feedback materially improves output quality* is
  documented, not speculative.

**Design implications for our cockpit.**

- **The "exhaust trail" metaphor is exactly right.** Tool calls are
  discrete events with a known shape (file edit / command run /
  test result). Each is small enough to be a *single visual
  artifact*, large enough to encode meaningfully:
  - **Size** = lines changed (or stderr length, or test count)
  - **Colour** = artifact type (edit = white, command = amber,
    test pass = green, test fail = red, read = grey)
  - **Shape** = something secondary (square = file edit, hex = test,
    diamond = decision, dot = small read)

- **It replaces the pulse animation.** Today's halo heartbeat is
  *abstract motion* (pretty, low-signal). The exhaust trail is
  *concrete history* (information-dense, scannable). This is a
  direct upgrade in honesty per Pirolli scent.

- **Click-to-diff aligns with Pirolli + Endsley Comprehension.**
  Strong preview on the artifact (size, colour, shape), full
  evidence on click. Same pattern that the decision-context block
  already uses on SessionDetail.

- **In-flight comments as agent input is the highest-leverage move.**
  The current cockpit's only mid-flight intervention is "send
  message to live session" (buried in SessionDetail). The proposed
  flow — **comment on a specific artifact in the trail, agent sees
  the comment as part of its next tool-call context** — is much
  more targeted. It's the "scoping correction" pattern (from the
  scoping trace) generalised to implementation.

- **Implementation requires a hook surface change.** Today:
  PreToolUse hook returns allow/deny. To inject a steering comment
  mid-flight, the hook needs to optionally return a *user message*
  to inject before the next turn. Claude Code's hook protocol does
  not currently support this directly; we'd either (a) wait for
  it, (b) inject via the resume-with-stdin path, or (c) move that
  agent type to the SDK adapter where `canUseTool` / system-prompt-
  injection is more flexible.

**Tension to be aware of.**

- **Concurrent review changes the operator's load profile.** Today
  the operator is *batched* — they look when something needs them.
  If the trail invites continuous reviewing, it could push them
  *back* into the always-on attentional mode that the dark-cockpit
  philosophy was designed to escape. Worth designing the trail so
  *the operator can ignore it most of the time* and just glance to
  confirm things are flowing.
- **Comments-as-context can pollute the agent's context window.**
  Per the agent-handoff decision, context bloat degrades quality.
  The trail's design must allow comments without auto-injecting
  them into context — agents read comments only when they're
  relevant to the current tool call (e.g., comment on an edit the
  agent is about to revisit).
- **The trail is per-session, but the cockpit is fleet-wide.** Ten
  agents = ten trails. Visual scaling matters. May need to be
  collapsed-by-default with the active session's trail expanded.

**The space-elevator framing (operator metaphor).** A specific visual
proposal for how the trail renders in the portfolio map context,
worth recording before it gets diffused:

- Each agent is an **elevator car** (the existing tile geometry
  remains — polygon, state-coloured, master-caution-pulsing). It
  *climbs* a vertical cable.
- **The cable itself appears to be moving** (downward scroll
  animation), not the elevator. The elevator stays in view; cable
  flows past it.
- **Climb rate = token velocity.** Faster work = the cable scrolls
  past faster. Stuck agent = cable visibly slows. This makes
  velocity an *ambient* signal, not a number you have to read.
- **Artifacts drop out the back of the elevator** as the agent
  emits tool calls. Each artifact stays anchored to its drop point
  on the cable, so as the cable moves down past the elevator, the
  artifact trail extends downward into the recent-history zone.
- **Artifact encoding** stays as proposed (size = lines changed,
  colour = type, shape = category). Click an artifact in the
  trail → diff/details overlay. Comment inline = injected into
  the agent's next-turn context.
- **The cable is finite and disappears past the bottom of the
  view.** Older artifacts scroll off screen, but the session detail
  panel preserves the full trail in scroll-back. Periphery vs.
  detail, exactly the Pirolli + Weiser pattern.
- **All elevators share the same rendered space**, side by side or
  in a grid. Healthy fleet = several elevators climbing at modest
  steady rates with small calm artifacts. Stressed fleet = one
  elevator climbing fast with red/large artifacts; another stalled
  with no recent drops. *The fleet's productivity becomes legible
  at a glance.*

This is the most compelling concrete *visual* proposal we have for
encoding sustained work without a number readout. It deserves
prototyping when the trail concept gets built — the "elevator"
framing solves the hardest design problem (how do you show steady
progress as ambient motion without it becoming a noise generator)
in a way the pulse animation never did.

A second-order benefit: **stuck agents become visually obvious**
because the cable stops moving. The bottleneck-2 (peripheral
attention) fix doesn't even need the audio channel to pre-empt
this case — the absence of motion is its own salience.

**Where this fits in the bottleneck framing.**

| Bottleneck             | Does the exhaust trail help?                    |
|------------------------|-------------------------------------------------|
| 1. spawn friction      | No                                              |
| 2. peripheral attention| Partially — replaces low-info pulse with high-info trail, easier to scan when glancing |
| 3. approval-tax        | No directly — but in-flight comments could prevent some decisions from being needed at all |
| 4. decision context    | Indirectly — when a decision fires, the trail leading up to it IS the context |
| (NEW) review-fall-off  | Yes — the unnamed fifth bottleneck of "I lose context if I review only at the end" |

**Where it could rank in the redesign sequence.**

After the four named bottlenecks. Possibly *before* the verification
surface, since the trail could absorb a lot of what verification was
going to do (the operator has already been reviewing as they go;
verification is just the final sign-off, not the first look).

**Open questions worth answering when we get to it.**

- Do operators *want* concurrent review, or do they prefer batched?
  This is testable per-operator. Some will want one mode, some the
  other. Maybe a per-agent mode toggle (the way IDEs offer
  "live linting" vs "lint on save").
- What's the right collapsed/expanded grammar for ten parallel
  trails?
- Is the trail per-tool-call or per-meaningful-change-unit? An agent
  can run 30 reads then one edit — 30 trail artifacts is noise; one
  consolidated "explored these files" object plus the edit is
  signal.
- How do comments survive across the scoping → implementation
  boundary? (If an in-flight comment becomes a permanent decision,
  it should land in the ledger.)
- What's the relationship to the "scope-question" decision type
  proposed in `agent-handoff-decision.md`? The trail-comment
  mechanism could subsume it.

**Sources.**

- [Interactive Debugging and Steering of Multi-Agent AI Systems (AGDebugger, CHI 2025)](https://dl.acm.org/doi/10.1145/3706598.3713581) — the canonical academic precedent, already cited in our `VISION.md`
- [VS Code feature request: "Live Steering" and Mid-Run Feedback for Agent Mode (issue #288920)](https://github.com/microsoft/vscode/issues/288920) — the productised version of the idea, currently unsolved
- [VF-Coder: Coding with Eyes — Visual Feedback Unlocks Reliable GUI Code Generating and Debugging (arXiv 2604.19750)](https://arxiv.org/html/2604.19750v1)
- [Damocles — VS Code extension with inline tool-call diff preview](https://github.com/AizenvoltPrime/damocles)
- [Event Horizon — VS Code extension visualising agent activity as a cosmic system](https://github.com/HeytalePazguato/event-horizon)
- [oh-my-pi — terminal AI coding agent with real-time artifact streaming](https://github.com/can1357/oh-my-pi)
- [AI SDK Artifacts — Structured Streaming for AI Applications](https://ai-sdk-tools.dev/artifacts)
- [Streaming Flow Execution — CrewAI](https://docs.crewai.com/en/learn/streaming-flow-execution)
- [Streaming — OpenAI Agents SDK](https://openai.github.io/openai-agents-python/streaming/)

---

## 4. Auto-research loop applied to coding agents — closed feedback for hill climbing

**Question.** Operator hypothesis: take inspiration from Karpathy's
autoresearch and apply the *closed self-improvement loop* idea to
software engineering agents. The cockpit becomes the harness for
auto-verification, performance feedback collection, and continuous
hill climbing toward our goals.

This is downstream of and orthogonal to the named bottlenecks but
genuinely changes the shape of what the cockpit is *for*: not just
"route attention well" but "be the closed loop in which agents +
operator continuously improve."

**What the research says.**

- **Karpathy's autoresearch (March 2026, 21k stars in days).** Single-
  GPU LLM training harness, ~630 lines of Python. Agent reads its own
  source, hypothesises an improvement, edits training code, runs a
  fixed 5-minute training experiment, keeps if validation
  bits-per-byte (BPB) improved, discards otherwise. Two-day overnight
  run produced 700 experiments and 20 retained optimisations. Shopify's
  CEO reported a 19% performance gain in 37 experiments overnight.
  **The pattern: constrained harness, single fitness signal, fixed
  compute budget per iteration, keep-or-discard, no human in the
  loop.**

- **Karpathy's broader thesis ("loopy era").** Agents running
  continuous self-improvement loops on code and research will become
  standard at frontier labs. Picked up by Fortune, VentureBeat, and
  the broader practitioner community in the days following the
  release. The framing is gaining real traction.

- **Hill climbing as practitioner framework (Cline).** Cline's blog
  ["A practical guide to hill
  climbing"](https://cline.bot/blog/a-practical-guide-to-hill-climbing)
  documents the exact shape: run agent on standardised tasks, measure
  the score, change *one* thing (prompt tweak / bug fix / config flag),
  re-run, keep if score went up. In practice they went from 47% → 57%
  on Terminal-Bench by diagnosing every failure and shipping targeted
  fixes. **Pure scientific method, applied to agent harness
  engineering.**

- **Anthropic's "Demystifying evals for AI agents".** The official
  framing for *eval-driven agent development*:
  > "Capability evals should start at a low pass rate to give teams
  > 'a hill to climb,' and as teams hill-climb on capability evals,
  > it's important to also run regression evals to make sure changes
  > don't cause issues elsewhere."
  Three legs: capability evals (the hill), regression evals (don't
  break what works), and traces enriched with feedback (the
  diagnostic).

- **AgentGym + GEM (Gym for Agentic LLMs, ICLR submission).**
  Academic infrastructure for the same idea. AgentController is the
  named pattern: the component that connects the agent and the
  environment, evaluates the agent, collects data, and (potentially)
  trains it. Designed for *generally-capable* agents that explore and
  evolve across environments.

- **Self-evolving agents (OpenAI cookbook).** Concrete pipeline:
  baseline agent run → output evaluated by humans + LLM-as-judge →
  feedback aggregated into score → new prompts generated → re-tested
  against same eval criteria. Continuous flywheel, not one-shot.

**Design implication for our cockpit.**

This isn't a fifth bottleneck. It's a **whole new bottleneck class**:
not "the operator's cognitive load on day N" but "agent quality
*compounding* over months." The cockpit can be the harness that
makes this work, IF we design for it. Specifically:

- **Every agent run is already an experiment** in our setup —
  worktree-isolated, deterministic-ish (fixed mock data, fixed prompt
  given the scope artifact), with measurable outputs (decision count,
  resolution count, time-to-done, accepted-diff rate, rework rate).
  We've been treating runs as one-off; the autoresearch frame asks
  us to treat them as a *training set*.

- **The decision ledger is already a feedback signal**, but we've
  been using it as audit trail. The autoresearch frame: every
  approve/block/reply is a *labelled outcome* the agent could learn
  from. Aggregated across many sessions, the ledger becomes the
  *reward function* for hill climbing.

- **Per-agent persistent identity (item 6 in `critique.md`'s
  ranked roadmap) is necessary infrastructure for this.** Without
  stable identity, you can't track an agent's competence over time.
  Without competence over time, there's no hill to climb.

- **The bottleneck-3 falsification metric (decisions per agent-hour)
  becomes a fitness signal.** A successful auto-research loop on
  the cockpit would: identify failure-causing prompt patterns, modify
  the agent's spawn-time prompt, and watch decisions-per-hour drop
  while accepted-diff-rate stays flat or rises. Hill climb.

- **The cross-model verification framing (§1) couples here.**
  Anthropic's three-leg framework explicitly names regression evals
  alongside capability evals. A different-model verifier can serve
  as the regression check — "did this change break what was working
  before?" — without needing to run the full implementation again.

**Tension to be aware of.**

- **Hill-climbing on the wrong metric is dangerous.** Cline's 47%→57%
  was on Terminal-Bench (an external standardised benchmark). On
  *our* metrics, we're optimising the cockpit-as-instrument, not
  the agent-as-engineer. If the agent learns "produce things that
  the cockpit-classifier doesn't flag" instead of "produce good
  code," we've Goodharted ourselves. The fitness signal must be
  grounded in eventual *merged-code* quality, not cockpit-internal
  proxies.

- **Closed-loop self-modification crosses an authority line.**
  Karpathy's autoresearch modifies *its own training code*. We
  should be very deliberate about whether the cockpit's
  auto-research agents modify *their own prompts* (probably yes,
  with operator gate) vs. *the cockpit code itself* (probably never
  without explicit per-change approval).

- **Compute / billing.** Karpathy's autoresearch ran on a single
  GPU at fixed budgets. Our equivalent — agents running real coding
  tasks — is much more expensive, especially if cross-model
  verification is part of the loop. Need to set per-experiment
  compute and time budgets explicitly.

- **Ground truth is harder for software engineering than for
  pretraining.** BPB is a single scalar that doesn't lie. "Did this
  PR ship?" is closer but slow and noisy. "Did the operator approve
  this PR?" is fast but learnable in unhelpful ways. The fitness
  signal *is* the hardest design question.

**Where this fits in our roadmap.**

Not Group A (the throughput release). Not Group B (peripheral
attention + verification). **Group C, item 11 (new) — "Closed
auto-research loop for agent prompts/skills,"** layered on top of:

- Per-agent persistent identity (Group C item 6) — required
  substrate.
- Cross-model verification (§1) — provides the regression check.
- Verification surface (Group B item 5) — provides the labelled
  outcomes.
- Decision ledger as canonical history (already shipped, vision
  principle 4) — provides the training data.

**Falsification.** Same shape as autoresearch itself: pick a
fitness signal, run N experiments at fixed budget, count retained
improvements. If after, say, 50 experiments, fewer than 5%
produce a retained improvement on a *held-out* task set (not the
training tasks), the loop isn't working — the signal is too noisy
or the search space is too underconstrained.

**Concrete first move when we get there.**

The smallest credible auto-research loop in our setup, modeled on
Karpathy's 630-line minimal:

1. Pick a small task (e.g., "fix this typo" + "add this test" +
   "rename this function across N files") with verifiable
   outcomes.
2. Define the fitness signal — say, *time-to-merged-PR* with
   *no human-rejected interventions*. Measurable end-to-end.
3. Pick the optimisation surface — the **scope artifact's prompt
   template**. Vary it; agent spawns from each variant; cockpit
   measures.
4. Fixed budget per experiment (one full task run, time-capped).
5. Keep-or-discard based on the fitness signal.
6. Operator review on retained changes before they go into
   production-default.

That's a two-day autoresearch session for the cockpit's own
scoping-artifact template. If it works, the same loop generalises
to per-capability autonomy presets, decision-card formats, agent
spawn parameters, etc.

**Open questions worth answering when we get there.**

- What's our equivalent of BPB — a scalar fitness signal we trust
  not to lie?
- What's our held-out task set, distinct from the training tasks?
- Do we run autoresearch on the agents (their prompts/skills) or
  on the cockpit (its classifier rules, its autonomy defaults)? Or
  both, with different cadences?
- How does this interact with the operator's role? The vision says
  "supervision is the load-bearing relationship" (principle 7) —
  autoresearch is *autonomous*, no human in the loop. The frame
  must be: *the operator stays in the loop for production agents;
  autoresearch happens on side-channel test agents.*

**Sources.**

- [karpathy/autoresearch — GitHub](https://github.com/karpathy/autoresearch) — the reference implementation
- [Why everyone is talking about Andrej Karpathy's autonomous AI research agent — Fortune](https://fortune.com/2026/03/17/andrej-karpathy-loop-autonomous-ai-agents-future/)
- [Andrej Karpathy on Code Agents, AutoResearch and the Self Improvement Loopy Era of AI — NextBigFuture](https://www.nextbigfuture.com/2026/03/andrej-karpathy-on-code-agents-autoresearch-and-the-self-improvement-loopy-era-of-ai.html)
- [Skill Issue: Andrej Karpathy on Code Agents, AutoResearch — YouTube](https://www.youtube.com/watch?v=kwSVtQ7dziU) — the long-form interview
- [VentureBeat: Karpathy's autoresearch lets you run hundreds of experiments a night](https://venturebeat.com/technology/andrej-karpathys-new-open-source-autoresearch-lets-you-run-hundreds-of-ai)
- [Autoresearch: Karpathy's Minimal "Agent Loop" — Kingy AI](https://kingy.ai/ai/autoresearch-karpathys-minimal-agent-loop-for-autonomous-llm-experimentation/)
- [Demystifying evals for AI agents — Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [A practical guide to hill climbing — Cline](https://cline.bot/blog/a-practical-guide-to-hill-climbing) — the practitioner playbook
- [The Agent Improvement Loop Starts with a Trace — LangChain](https://www.langchain.com/conceptual-guides/traces-start-agent-improvement-loop)
- [AgentGym: Evolving LLM-based Agents across Diverse Environments — project page](https://agentgym.github.io/)
- [GEM: A Gym for Agentic LLMs (arXiv 2510.01051)](https://arxiv.org/html/2510.01051v1)
- [Self-Evolving Agents — A Cookbook for Autonomous Agent Retraining (OpenAI)](https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining)
- [Self-Improving Coding Agents — Addy Osmani](https://addyosmani.com/blog/self-improving-agents/)

---

## 5. Analytical store (ClickHouse-shape) for the autoresearch flywheel

**Question.** Operator hypothesis: should we run a separate analytical
store (e.g., ClickHouse) alongside Postgres to pick up agent decision
streams + events for analysis as we go? Couples directly to §4 — if
the cockpit is the autoresearch harness, where does the analysis live?

**What the research says.**

- **OLTP vs. OLAP separation is well-trodden.** Postgres is the
  default operational store; row-oriented; great for live UI
  queries + transactional consistency. ClickHouse is column-
  oriented, optimised for wide aggregations across hundreds of
  millions of rows, with sub-second p99 on OLAP shapes. The
  separation is real but the threshold for needing it is higher
  than people assume.

- **Most teams introduce the analytical store too early.** ClickHouse
  starts paying off at row counts in the **hundreds of millions to
  billions** for typical agent-event workloads, or when analytical
  queries genuinely contend with operational writes. Below that,
  Postgres + good indexes is sufficient and *much* simpler.

- **DuckDB is the lighter middle ground for single-user analytics.**
  Embedded, columnar, no server. Reads Postgres dumps directly,
  runs OLAP-shaped queries on a developer's laptop. For
  exploratory analysis on cockpit history, DuckDB is closer to the
  right shape than ClickHouse — single user, no concurrent
  analytical workload, just "let me run wide aggregations on a
  couple of months of events without locking the live DB."

- **The autoresearch fitness-signal problem isn't a query-speed
  problem.** Per §4: *"ground truth is harder for software
  engineering than for pretraining."* BPB doesn't lie; "did this
  PR ship?" is slow + noisy; "did the operator approve?" is fast
  but Goodhartable. Faster querying doesn't fix that — it just
  lets you run the wrong query faster.

**Design implication for our cockpit.**

**Don't add ClickHouse now.** Three reasons.

1. **Volume.** ~10 agents × ~100 events/session × a few sessions/day
   ≈ low thousands of rows daily. Postgres handles this for years.
2. **The hard problem is upstream.** Fitness-signal definition,
   per-agent identity, decision-ledger-as-labels — all of which
   live in the operational schema, not in the analytical store.
   Adding ClickHouse before solving those gives a faster way to
   ask the wrong question.
3. **Operational complexity tax.** Replication setup, schema sync,
   backfill, dual-write or CDC. Real engineering hours that don't
   advance any of the four named bottlenecks.

**But the question raises something real that we should act on now**:

- **Schema discipline matters even before the second store.** Today
  `cockpit_events.payload` is `jsonb`. Flexible but bad for
  analytics — `payload->>'exitCode'`-style extraction every time.
  As we know we want autoresearch later, we should **promote
  frequently-queried fields out of the JSON blob into typed
  columns** as we add them. That's a Postgres-only refactor, no new
  infrastructure, with two benefits: (a) cheaper analytics
  immediately, (b) cleaner schema if we ever do go to ClickHouse.

**Where this sits in the roadmap.**

Not Group A. Not Group B. Not Group C item 11 (the autoresearch
loop itself). **Infrastructure that *enables* item 11 at scale**,
but only at scale.

Smallest credible sequence when we eventually need it:

1. Land per-agent identity (Group C item 6) — stable join keys.
2. Build the autoresearch loop on Postgres first (item 11) —
   prove the fitness signal works. Use DuckDB locally for
   exploratory queries against Postgres dumps.
3. **Only then**, if the operational DB feels analytical pressure
   OR analytical queries need history that's been pruned from
   the hot DB, introduce a dedicated analytical store.

When that moment arrives, the choice is between:

- **DuckDB embedded** (single-user analyst on laptop, simplest).
- **Postgres logical replication into a dedicated analytics DB**
  (stays inside our existing stack, multi-user-capable).
- **ClickHouse** (multi-user, sub-second on billions of rows; the
  right answer at *real* scale).

Pick the right one for the load profile we actually have at that
point — don't pre-commit now.

**Tension to be aware of.**

- **Schema migration ergonomics get worse as data grows.** If we
  start typing event-payload fields late, we'll be doing big-table
  migrations on production data. Better to start the discipline
  now even though volume is low.
- **The cockpit's WS broadcast is fed off the operational DB
  events table.** A real ClickHouse split would mean the live UI
  reads Postgres while analytics reads ClickHouse — fine, but
  *autoresearch loops that want fresh data* sit on the analytics
  side and would lag the operational side by replication interval.
  Fine for overnight runs; bad for live-loop coupling.
- **The autoresearch loop *itself* generates writes.** Each
  experiment is N rows in the ledger / events table. If the loop
  runs hundreds of experiments overnight (à la Karpathy), volume
  picks up faster than it does for organic operator usage.

**Concrete first move, today, instead of adding ClickHouse:**

Rolling refactor: as we land Group A items, **convert each new
high-cardinality JSON field into a typed column** when there's a
clear analytical use for it. Start with:

- `cockpit_events.payload->>'exitCode'` → `cockpit_events.exit_code int`
  (used by the failed-validation classifier).
- `cockpit_events.payload->>'toolName'` → `cockpit_events.tool_name text`
  (used by the trigger classifier).
- `cockpit_decisions.resolvedBy` already exists, but add
  `cockpit_decisions.resolution_latency_ms int` derivable on
  resolution.

Each of these is a 5-line schema migration + a backfill. Doing it
incrementally costs us ~nothing per change; doing it all at once
later costs us a long migration window.

**Open questions worth answering when we get there.**

- DuckDB vs. dedicated Postgres replica vs. ClickHouse — the
  cleanest answer depends on whether autoresearch is single-
  operator (DuckDB plenty) or multi-tenant cockpit (replica) or
  large-scale (ClickHouse). Phase 1 is single-operator.
- What's our event retention policy on the operational DB? Today,
  events are kept indefinitely. At some volume that hurts — but
  pruning means we lose the autoresearch training data unless we
  archive somewhere. The dedicated analytical store *is* that
  archive, in some sense.
- Can we run autoresearch *experiments* in a separate "experiment
  workspace" where it's safe to wipe and rebuild data? If yes, the
  analytical store concern partially decouples from the
  operational store.

**Sources.**

- [Postgres vs. ClickHouse — when to use which (ClickHouse Inc)](https://clickhouse.com/blog/clickhouse-postgres-comparison)
- [DuckDB — embedded analytical database](https://duckdb.org/why_duckdb)
- [Anthropic: demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — names the regression-eval and capability-eval distinction that this analytical store would feed

---

## 6. State machine library (XState et al) — when does it earn its keep?

**Question.** Operator hypothesis: should we be using XState (or
similar typed state-machine library) instead of `text` columns +
hand-rolled transition logic for our session lifecycle?

**Short answer.** Not yet, possibly never for the session lifecycle
itself. But there are *specific* upcoming surfaces — the scoping
artifact, the autoresearch experiment lifecycle — where it would
earn its keep. Re-evaluate when we build those.

**What the analysis says.**

- **The current session state machine isn't really branching.**
  `queued → orienting → implementing → validating → blocked /
  needs-decision / ready-for-review → merged / stale-zombie`. ~10
  states with mostly linear transitions. Branches at `validating`,
  handled by conditional writes in `persistence.ts`. XState shines
  with *complex orthogonal regions* (a video player with
  independent playback / fullscreen / network states); we don't
  have those.

- **Our state lives in Postgres, not in memory.** XState is a
  *runtime* state machine. Our session state is a persisted `text`
  column read on every API request and broadcast over WebSocket.
  Wrapping every read/write in an XState interpreter adds
  serialisation overhead (XState context → JSON → DB → JSON →
  context) without solving a problem we have.

- **The current text + CHECK + Drizzle-typed-insert combo is
  enough.** TypeScript narrows at compile time; CHECK constraints
  enforce at the DB; Drizzle types catch typos in inserts. The
  three layers cover the actual failure modes.

**Where XState would earn its keep.**

When (and only when) we build either of these, re-evaluate:

1. **Scoping artifact lifecycle.** `draft → editing → agreed →
   superseded`, with concurrent edits, hover-pause cooldowns,
   version history, and side effects on transition. That's
   genuine orthogonal-region complexity.
2. **Autoresearch experiment lifecycle (Group C item 11).**
   `proposed → running (with budget timer) → keep | discard`,
   with timed transitions, side effects on each leg, and
   compositions of multiple experiments. Karpathy's autoresearch
   is essentially XState-shaped; we'd be foolish to roll our own
   for the equivalent.

**Tension.**

- **Library lock-in.** XState's API has churned across major
  versions. We'd be tying our most important runtime semantics
  to one library's release cadence.
- **Two state-machine systems is worse than one.** If we adopt
  XState for *some* lifecycles and not others, contributors have
  to know when to use which. Pick a single pattern when we
  introduce it.

**Decision today.** Defer. Continue with text + CHECK + Drizzle.
When the scoping artifact ships in Group A step 3, the lifecycle
there is small enough (3-4 states, no orthogonal regions) to
hand-roll. Re-evaluate on autoresearch (Group C).

**Sources.**

- [XState — Stately docs](https://stately.ai/docs)
- [Why I'm not using XState anymore — David K. Piano (XState
  author)](https://www.davidkhourshid.com/articles/why-im-not-using-xs)
  — read for the honest argument from the person most likely to
  oversell it.
- [State Machines in TypeScript without dependencies — Boris Cherny](https://wcandillon.medium.com/state-machines-in-typescript-without-dependencies-cd70b7d7fd2)
  — the case for hand-rolling.

---

## Summary: what to remember

- **Cross-model verification: yes, it's worth doing — when we get
  to verification UX.** Same-model review is empirically
  degenerate. SDK adapter becomes load-bearing for this. Cost will
  show up.
- **Heterogeneous *teams* are NOT the same as cross-model
  verification.** Don't build consensus-seeking ensembles for
  implementation. Single agent per session, one handoff at a time.
- **Agent-to-agent direct messaging is almost always the wrong
  abstraction.** Use artifact handoff (already decided), git for
  shared committed state, and the cockpit as the only entity that
  routes attention between agents.
- **A situation log might genuinely be a blackboard pattern — but
  written by the cockpit, not agents.** This is principle 3 from
  the vision, mostly unbuilt. When we build it, the discipline is
  *durable problem objects with lifecycle*, not chat.
- **Redis is already in our stack and is the right infrastructure
  if we ever need it for live blackboard updates.** Don't reach
  for it preemptively — Postgres + WS broadcast is enough at
  current fleet scale.
- **The exhaust-trail / concurrent-review idea is a separate
  bottleneck — "I lose context if I review only at the end" — and
  is exactly what VS Code agent-mode users are asking for in an
  open feature request right now.** Has academic precedent
  (AGDebugger, CHI 2025). Replaces the low-info pulse animation
  with high-info trail. Slot it after the four named bottlenecks,
  possibly before verification surface (which it partly subsumes).
- **Karpathy's autoresearch pattern applies to coding agents and
  the cockpit is the right harness for it.** Constrained harness,
  single fitness signal, fixed compute budget per iteration,
  keep-or-discard. Treats every agent run as an experiment, the
  decision ledger as the labelled training set, and per-agent
  identity as the substrate for tracking compounding improvement.
  Lives at the bottom of the roadmap (Group C, item 11) because it
  *requires* per-agent identity, cross-model verification, and the
  verification surface as substrate. The danger to manage: hill-
  climbing on cockpit-internal proxies (Goodhart) instead of
  merged-code-quality.
- **State machine library (XState et al) — defer.** Current text +
  CHECK + Drizzle-typed-insert covers the failure modes. The two
  upcoming surfaces where it would earn its keep are the scoping
  artifact lifecycle (small enough to hand-roll initially) and the
  autoresearch experiment lifecycle (Group C — re-evaluate then).
  Watch for "two state-machine systems is worse than one" pitfall.
- **Don't reach for ClickHouse for the autoresearch flywheel.**
  Postgres handles our volume for years. The hard problem (fitness
  signal, ground truth) lives upstream of query performance. DO act
  now on the related discipline that *will* compound: rolling
  refactor of high-cardinality JSON fields into typed columns as
  we land Group A items. That's free schema-cleanliness now and
  cheap analytics later, regardless of whether we ever add a
  dedicated analytical store.

**Last verified:** 2026-04-26. Recheck if revisiting these decisions.
