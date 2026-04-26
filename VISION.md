# Swarm — an Attention OS for coding agents

*A research and vision doc for one human commanding 10+ AI coding agents across 3+ projects.*

Status: research synthesis, 2026-04-25.

---

## TL;DR

The bottleneck for a senior engineer running 10+ AI coding agents in parallel across multiple projects isn't orchestration — it's **attention and decision throughput**.

Existing tools each solve one slice: cloud agent execution (Devin, Cursor BG, Codex, Copilot Coding Agent), local worktree isolation (Conductor, Crystal, Emdash, claude-squad), observability (Langfuse, Phoenix), or single-tool inboxes (LangChain Agent Inbox). None aggregate across surfaces or design for the supervisor's cognitive load.

**Swarm is the missing layer above those surfaces**: a dark, opinionated cockpit whose primary job is routing the operator's attention to the next decision that matters. It draws on grand-strategy game UIs (Stellaris outliner + situation log), aviation (dark cockpit, master caution, GO/NO-GO), supervisory-control theory (Sheridan, Endsley), and the recent practitioner literature on parallel coding agents (Willison, Litt, Cherny, Anthropic engineering).

**Canonical state in cockpit**: decisions and attention.
**Canonical state elsewhere**: code (git), conversations (Slack), tickets (Linear / GitHub).

---

## The problem

A senior engineer running an internal agent platform routinely runs 10+ coding agents — some local (Claude Code in tmux/worktrees), some cloud (Devin sessions, Cursor background agents, Copilot tasks, Codex cloud) — across 3+ codebases. Today's state of the art is ad-hoc:

- Numbered terminal tabs (the Boris Cherny pattern: ~10–15 concurrent Claude Code sessions, OS notifications)
- Slack as a control surface for cloud agents (Devin / Codegen / Factory)
- GitHub PR review as the supervision endpoint
- Polling each surface manually for "anything need me?"
- OS notifications flooding from multiple sources with no priority

This works for ~5 agents. Past that, three failure modes dominate:

1. **Lost context on switch.** Moving between projects loses scroll/filter state and forces re-orientation each time.
2. **Notification firehose.** Every agent pings for every decision — signal/noise collapses, alarm fatigue sets in (the same dynamic ICUs spent 30 years studying).
3. **Aging blockers.** Agents wait silently for hours; humans don't notice until standup.

The dominant industry framing treats this as an *orchestration* problem. It isn't. It's a **human supervisory control** problem. Anthropic's multi-agent research-system paper, Cognition's "Don't Build Multi-Agents", and METR's July 2025 RCT (experienced OSS devs were 19% slower with early-2025 AI tools while feeling 20% faster) all point at the same thing: the human cognition layer is the bottleneck, and most product UX makes it worse.

---

## Thesis: an Attention OS, not a dashboard

**Swarm is the attention and decision router that sits above the surfaces agents already live in.**

It does not replace Slack, PRs, terminals, or cloud agent dashboards. It ingests from them and surfaces the operator's *next decision*. The cockpit is canonical for **what needs my attention, what did I decide, and what is the current operating picture**. Everything else stays canonical where it lives.

This framing is deliberately scoped:

- **Not a unified message bus.** Replying to Slack still happens in Slack.
- **Not an agent runtime.** Agents run wherever they run.
- **Not yet another IDE.** Code review happens in PR review.

The cockpit's job is the missing one: *"where do I look right now, and what does the audit trail say?"*

The honest cost of this framing: aggregators that *also let you act* require per-tool bidirectional integration. Reading from each source is straightforward; writing back (approve, comment, resume) is real engineering. The wedge is **attention and decisions**, not aggregation for its own sake. Resist becoming a Slack client.

---

## Design principles

### 1. Dark cockpit by default

Healthy fleet = boring screen. Borrowed from Airbus glass-cockpit philosophy: any visual energy means *abnormal*. The supervisor learns to scan when something lights up, not to graze a feed.

Two-stage attention grab: **master caution** glow draws the eye → labelled annunciator names the offending subsystem.

### 2. Notification → decision queue

Don't display events. Display **decisions needing a human**. The queue ages: oldest first. The top line is glanceable:

> *"7 decisions needed, oldest 4h, 3 unblock 5 agents — fleet healthy, $24/h burn."*

Trigger events are explicit — only these make the queue:

- scope ambiguity
- destructive action pending
- architectural tradeoff
- failed validation
- merge conflict
- security concern
- spend / time threshold crossed

Everything else is summarized at task boundaries (Czerwinski's breakpoint principle).

### 3. Situation log > notification feed

Borrowed from Stellaris / EU4. Long-running problems — a stalled PR, an agent that's failed three times on the same test, a cost-burn anomaly — become **durable objects** with lifecycle, owner, SLA, and resolution state. Not just timestamps in a feed.

### 4. Decision ledger as canonical history

Persistent record per decision: what the agent assumed, what it asked, what the human decided, why, and which PR/commit/session it affected. The ledger is the artifact PRs reference. This is the only persistent history Swarm owns; transcripts stay in their underlying tools.

### 5. Per-capability autonomy

Don't ask "is this agent autonomous?" Ask, per agent, per capability:

| capability | policy |
| --- | --- |
| edit code | allow / ask / never |
| push branch | allow / ask / never |
| open PR | allow / ask / never |
| merge | ask |
| run migration | ask |
| touch prod config | never |
| spend over $X | ask |

This vocabulary appears in the UI directly. A policy is a row of toggles. (Sheridan's levels-of-automation, made concrete.)

### 6. Grand-strategy framing, not StarCraft

The supervisor of 10+ coding agents is closer to a Stellaris/EU4 player (persistent fronts, slow-burn situations, partial automation) than a StarCraft player (high-APM micro). The dominant interaction is reading the operating picture, not 300 actions per minute.

StarCraft still contributes the *micro* — idle-worker badges, control groups — within the queue. But the dominant mental model is grand strategy.

### 7. Many isolated workstreams, not a swarm

Architectural commitment: each agent runs in an isolated worktree/sandbox. No real-time agent-to-agent coordination. Multi-agent reserved for read-only scout/research/review patterns where Anthropic's research-system pattern shines. **Supervision is the load-bearing relationship, not collaboration.**

### 8. Measure ourselves

Built-in metrics from day one as a hedge against the METR effect:

- blocked time per agent
- review time per PR
- accepted-diff rate
- rework rate
- cost per merged PR
- abandoned sessions
- human decisions per hour

If the cockpit makes you slower, you see it.

---

## Cockpit anatomy

### Surface

Single screen, dark by default. Layout sketch:

```
┌──────────────────────────────────────────────────────────────────────┐
│  7 decisions, oldest 4h, 3 unblock 5 agents — fleet ok, $24/h burn   │
├────────────────────────────────────────────────────┬─────────────────┤
│                                                    │  OUTLINER       │
│           PORTFOLIO MAP                            │                 │
│           (territories / fronts / agent tiles)     │  Project A      │
│           dark = healthy, glow = abnormal          │   ├─ Auth       │
│           strategic zoom: wheel out → fleet        │   │  • a-12 R   │
│                          wheel in → transcript     │   │  • a-15 V   │
│                                                    │   └─ Schema     │
├────────────────────────────────────────────────────┤      • a-08 D ←│
│                                                    │  Project B      │
│           DECISION QUEUE                           │   └─ ...        │
│           oldest first, one-click verbs            │                 │
│           batched approvals for low-risk           │                 │
│                                                    │                 │
├────────────────────────────────────────────────────┴─────────────────┤
│  SITUATION LOG  (lifecycle-tracked long-running problems)            │
└──────────────────────────────────────────────────────────────────────┘
```

**Top: glanceable summary line.** One row, always visible.

**Center-left: portfolio map.** Spatial overview of projects (territories) and workstreams (fronts). One tile per agent; color = state, size = activity, opacity = staleness. Healthy = dim. **Strategic zoom** (Supreme Commander style): wheel out to fleet, wheel in to a single transcript — no mode switch.

**Right rail: outliner.** Persistent collapsible tree (Stellaris-style):

```
Project A
├── Auth refactor (front)
│   ├── agent-12  [ready for review]
│   └── agent-15  [validating]
├── Schema migration (front)
│   └── agent-08  [needs decision] ←
Project B
└── ...
```

State machine values: `queued` → `orienting` → `implementing` → `validating` → `blocked` / `needs-decision` / `ready-for-review` → `merged` / `stale-zombie`.

**Center: decision queue.** The primary work surface. List of decisions, oldest first, with one-click verbs (`approve`, `ask`, `block`, `template-reply`). Batched approvals for low-risk groups; mobile-first for swipe interaction.

**Bottom: situation log.** Long-running problems with lifecycle, owner, SLA, resolution state. Not transient.

**Floating: master caution glow.** Single ambient signal (color + sound) when something abnormal happens. Two-stage attention grab.

### Controls

- **Per-capability autonomy policies** per agent (the toggle row).
- **Batched approvals** — group low-risk decisions; swipe / template responses.
- **GO/NO-GO ceremonies** for destructive actions — cockpit polls each gate (CI green? PR approved? open critical alerts?) before allowing the action; refuses on any NO-GO.
- **Edit/reset prior agent message** (AGDebugger-style) for context hygiene; auditable in the decision ledger.
- **Scenes** — saved cockpit views ("morning triage", "deep work on project A", "incident mode") bound to keys.
- **Control groups** — number-key-bound agent groups for hotkey focus (StarCraft micro within the grand-strategy frame).
- **Replay** — timeline of agent actions, tool calls, human interventions, outcomes. Per-session and cross-session.
- **Fixed verb vocabulary** for supervisor → agent commands ("stop", "explain", "ask first", "go ahead", "rebase", "switch model", "bring in a specialist") bound to a chord (LoL smart-ping radial).

### Architecture

**Ingest layer** — adapters per source:

- Local Claude Code: hooks (PreToolUse / PostToolUse / Notification) → IPC → Swarm
- Cloud agents (Devin, Cursor BG, Codex, Copilot Coding Agent): webhooks where available; polling fallback
- GitHub: PR events, review state
- Slack: agent-thread DMs (read-only subscriptions; no reply UI in cockpit)
- Langfuse / Phoenix: cost and trace data

**State layer** — SQLite (single-user) for:

- agent registry (id, project, source, capabilities)
- session state machine
- decision queue (with aging, owner, status)
- decision ledger (immutable record)
- situation log (open situations with lifecycle)
- metrics (decisions/hour, blocked time, etc.)

**Action layer** — outbound to source tools:

- Approve via Claude Code IPC (resume hook, send response)
- Comment on PR via GitHub API
- "Open in Slack" → URL handoff (no replying inside cockpit)

**Surface** — single-page web app, Electron-wrapped for desktop notifications + global hotkeys. Mobile = same web app, optimized for swipe-triage.

---

## Research foundations

### What's already been built

**Cloud agent runtimes** (one-task / one-session pattern):

- **Devin** (Cognition) — sessions list + Slack-thread-as-session-thread; the canonical Slack-as-control-surface implementation
- **Factory droids** — role-typed agents (Code/Knowledge/Reliability), bridges to Slack/Linear/PagerDuty
- **Cursor background agents + mobile app** — closest serious mobile-triage attempt
- **OpenAI Codex (cloud)** — fan-out / Best-of-N built into the UI
- **GitHub Copilot Coding Agent / Agent HQ** — most explicit "mission control" commercial play; reuses PR review as the supervision surface
- **Google Jules**, **Coder Tasks** — same async-task-in-cloud pattern

**Local fleet tools** (worktree-isolated multi-session):

- **Conductor** (conductor.build) — Mac app, parallel Claude Code workspaces with status + unified diff
- **Crystal** (github.com/stravu/crystal) — OSS Electron equivalent
- **claude-squad** (github.com/smtg-ai/claude-squad) — TUI grid in tmux
- **Emdash** (emdash.sh) — multiple agents in worktrees, Kanban, issue imports, Best-of-N comparisons; **closest existing implementation of the mental model**
- **Dagger Container Use** — per-agent containerized sandboxes + worktrees, MCP-pluggable

**Multi-agent orchestration UIs**:

- **LangGraph Studio** — graph view + time-travel debugger (fork-from-step is novel)
- **AutoGen Studio** — visual node-graph builder
- **CrewAI Studio** — drag-drop topologies
- **OpenHands** (formerly OpenDevin) — web UI with tabbed views per run

**Inbox/triage references**:

- **LangChain Agent Inbox** — explicit "agent inbox UX for HITL agents"; closest existing analog to the queue surface
- **Microsoft AGDebugger** (CHI 2025) — academic UI artifact: timeline overview, message reset/edit, steering. Most directly relevant academic prototype.

**Observability**:

- **Langfuse**, **Arize Phoenix**, **LangSmith**, **Braintrust**, **Helicone** — converging on Sessions / Traces / Datasets. Useful post-hoc; weak for live triage.

### Patterns that map (RTS / control rooms / HCI)

**RTS** — grand-strategy more than micro:

| Source | Pattern | Cockpit mapping |
| --- | --- | --- |
| Stellaris / EU4 | Outliner + situation log + per-category alert mute grammar | Right-rail tree + lifecycle log + per-class snooze |
| Supreme Commander | Strategic zoom (continuous, no mode switch) | Wheel out from transcript → fleet view |
| StarCraft | Idle-worker icon, control groups, mental checklist | Idle/blocked-agent badge; hotkey-bound groups; trained scan path |
| Factorio | Off-screen pointer arrows, alert decay, production graphs | Directional cue toward off-screen agent; ephemeral toasts; throughput sparklines |
| RimWorld / Dwarf Fortress | Pause-on-event, work bills, priorities | Per-class auto-pause of supervisor focus; priority-routed task assignment |
| League of Legends | Smart-ping radial — fixed verb vocabulary | Supervisor → agent verb chord |

**Real-world supervisory ops**:

- **Aviation glass cockpit** — dark by default, master caution/warning, three-state color grammar (red/amber/blue)
- **NASA mission control** — console roles, GO/NO-GO polls, voice loops
- **Air traffic control** — flight progress strips, conflict alerting, explicit handoffs (no silent transfers)
- **ICU monitoring** — alarm fatigue research; coalesce, defer, per-category mute beats global mute
- **SOC / NOC** — tiered triage with runbooks, war-room provisioning at severity bar
- **Ableton Session View** — scenes (atomic state recall across many lanes)

**HCI**:

- **Sheridan** — supervisory control, levels of automation
- **Endsley** — situation awareness model: Perception → Comprehension → Projection (most "agent dashboards" stop at Perception)
- **Horvitz** — mixed-initiative interfaces (1999); cost-of-interruption-aware notification
- **Shneiderman** — "overview first, zoom and filter, details on demand"
- **Lee & See** — trust calibration; visible competence history per agent
- **Mark / Czerwinski** — interruption science; breakpoint-aware delivery
- **Pirolli & Card** — information foraging / scent (strong previews, not dead-end clicks)
- **Weiser & Brown** — calm technology, peripheral awareness

### Practitioner reading

**Must-reads**:

- Simon Willison, "Embracing the parallel coding agent lifestyle" (2025-10-05) — simonwillison.net/2025/Oct/5/parallel-coding-agents/
- Boris Cherny, "How Boris uses Claude Code" — howborisusesclaudecode.com — the realistic baseline for ~10–15 concurrent sessions
- Anthropic, "How we built our multi-agent research system" — anthropic.com/engineering/multi-agent-research-system
- Geoffrey Litt, "Code like a surgeon" (2025-10-24) — geoffreylitt.com/2025/10/24/code-like-a-surgeon — primary vs. secondary task delegation
- Karpathy, 2025 year-in-review + "Animals vs Ghosts" — karpathy.bearblog.dev
- Jesse Vincent, "Superpowers" series — blog.fsck.com — lived TDD-with-subagents workflow
- Microsoft / CMU, AGDebugger (CHI 2025) — arxiv.org/abs/2503.02068 — direct academic analog

**Sober reading**:

- METR's July 2025 RCT — metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ — 19% slower while feeling faster
- Cognition, "Don't Build Multi-Agents" — cognition.ai/blog/dont-build-multi-agents — context engineering > orchestration
- Simon Willison, "Vibe engineering" (2025-10-07) — "surprisingly effective, if mentally exhausting"
- arXiv 2512.14012, "Professional Software Developers Don't Vibe, They Control" — seasoned devs resist loose autonomy

---

## Closest existing work to evaluate hands-on

Before designing further, run a half-day eval on:

1. **Conductor** (conductor.build) — the Mac-app worktree pattern
2. **Emdash** (emdash.sh) — closest existing implementation of the mental model: worktrees + Kanban + Best-of-N
3. **Crystal** + **claude-squad** — OSS reference points
4. **LangChain Agent Inbox** — for the inbox UX specifically
5. **AGDebugger** (github.com/microsoft/agdebugger) — for the edit/reset interaction

The eval question: *which slices of the cockpit are already adequately solved, and which are genuinely missing?* If Emdash gets 70% of the way there, the wedge is the queue + situation log + cross-tool aggregation.

---

## Open questions

1. **Single-user or multi-user from day one?** Single-user is simpler. Multi-user requires shared decision ledger and conflict-resolution semantics.
2. **What's the canonical decision unit?** Tool-call approval? Plan checkpoint? PR review? Different granularities change the whole UI.
3. **Mobile-first or desktop-first?** Cursor's mobile app is the only serious attempt. Desktop has more screen real estate; mobile is where supervision actually happens (between meetings, on couch).
4. **Where does cost live?** Per-agent gauge, fleet-level burn rate, or per-decision projection? All three are legitimate; all three risk being noise.
5. **How much agent history does Swarm retain vs. link to?** Decision ledger is canonical. But for replay / AGDebugger-style edit, do we need the full transcript or do we link out?
6. **Adapter strategy: read vs. write.** Reading from each source is straightforward. Writing back (approve, comment, resume) is per-tool integration work. Which writes are load-bearing on day one?
7. **Leading indicator that the cockpit is helping.** Decisions/hour? Median age of decision queue? Abandoned-session rate? Pick one to optimize.
8. **What happens when the human is offline?** Auto-pause everything, or let `allow`-policy work continue? (Town bell vs. queued orders.)

---

## Next steps

Three options, increasing in investment:

1. **Hands-on eval (½ day).** An hour each with Conductor, Emdash, Crystal, claude-squad, LangChain Agent Inbox. Note which slices are already adequately solved.
2. **Single-screen wireframe (1–2 hours).** Pressure-test where the queue, outliner, situation log, and portfolio map compete for real estate. Excalidraw or text mockup.
3. **Thin slice prototype (1–2 days).** Hooks → SQLite → web view of the decision queue, ingesting from Claude Code only. See if the queue alone changes a day of work before committing to the full surface.

Recommended order: **1 → 2 → 3.** The eval de-risks the wireframe; the wireframe de-risks the prototype.

---

## Reading list (URLs)

### Tools
- Devin: docs.devin.ai
- Factory: factory.ai, docs.factory.ai
- Cursor Agents: cursor.com/agents
- Claude Code: claude.com/claude-code
- GitHub Agent HQ: github.blog/news-insights/company-news/welcome-home-agents
- OpenAI Codex: platform.openai.com/docs/codex/overview
- Google Jules: jules.google
- Conductor: conductor.build
- Crystal: github.com/stravu/crystal
- Emdash: emdash.sh
- claude-squad: github.com/smtg-ai/claude-squad
- Dagger Container Use: github.com/dagger/container-use
- LangChain Agent Inbox: github.com/langchain-ai/agent-inbox
- AGDebugger: github.com/microsoft/agdebugger
- LangGraph Studio: langchain.com/langgraph
- OpenHands: all-hands.dev

### Practitioner essays
- simonwillison.net/tags/coding-agents/
- simonwillison.net/2025/Oct/5/parallel-coding-agents/
- simonwillison.net/2025/Oct/7/vibe-engineering/
- howborisusesclaudecode.com
- geoffreylitt.com/2025/10/24/code-like-a-surgeon
- karpathy.bearblog.dev
- blog.fsck.com/2025/10/09/superpowers/
- lucumr.pocoo.org/2025/6/12/agentic-coding/
- ampcode.com/notes/how-to-build-an-agent

### Anthropic engineering
- anthropic.com/engineering/multi-agent-research-system
- anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- anthropic.com/engineering/effective-harnesses-for-long-running-agents
- anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

### Sober / critique
- metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- cognition.ai/blog/dont-build-multi-agents
- newsletter.pragmaticengineer.com/p/are-ai-agents-actually-slowing-us
- arxiv.org/html/2512.14012

### Academic
- arxiv.org/abs/2503.02068 (AGDebugger, CHI 2025)
- erichorvitz.com/chi99horvitz.pdf (Mixed-Initiative)
- mitpress.mit.edu/9780262515474 (Sheridan, Supervisory Control)
- cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf (Visual Information Seeking Mantra)
- journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392 (Lee & See, Trust in Automation)
- ics.uci.edu/~gmark/chi08-mark.pdf (Mark, Cost of Interrupted Work)

### Supervisory / control-room references
- airflow.blog/2025/01/16/the-dark-cockpit-philosophy-enhancing-efficiency-and-safety-in-modern-aviation/
- en.wikipedia.org/wiki/Launch_status_check (NASA GO/NO-GO)
- en.wikipedia.org/wiki/Flight_progress_strip (ATC)
- frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2022.843747 (ICU alarm fatigue)
- liquipedia.net/starcraft2/Mental_Checklist
- supcom.fandom.com/wiki/Strategic_icon
- stellaris.paradoxwikis.com/Main_interface
