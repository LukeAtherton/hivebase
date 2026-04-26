# Cockpit — Attention OS for Coding Agents

_Plan for adding a supervision cockpit to the hivescaler monorepo._

Status: planning, 2026-04-25.
Source vision doc: `~/Projects/kybernos/VISION.md` (Swarm — an Attention OS for coding agents).

---

## TL;DR

Build a supervision cockpit ("Swarm" / "Cockpit" — naming TBD) as a new app inside the hivescaler monorepo. Its job is to route a single human's attention across 10+ AI coding agents running in parallel — local (Claude Code, Codex CLI in worktrees) and cloud (hivescaler jobs, later Devin/Cursor BG/Copilot Coding Agent).

The cockpit is **not** an orchestrator, message bus, or IDE. It is the missing layer above existing agent surfaces that answers: _"where do I look right now, and what does the audit trail say?"_

Canonical state in cockpit: **decisions and attention**.
Canonical state elsewhere: code (git), conversations (Slack), tickets (Linear/GitHub), jobs (hivescaler).

---

## Why inside hivescaler

Considered three options:

1. **Standalone repo** (this is what eventually happened — `~/Projects/kybernos`, originally codenamed `hivebase`) — best architectural purity (cockpit is a peer of all agent platforms, not a child of one), worst ergonomics (re-build auth, deploy pipeline, type-sharing).
2. **Folded into `apps/dashboard`** — best ergonomics, worst conceptual scope (dashboard manages the platform; cockpit supervises live work — different jobs, different metrics).
3. **New `apps/cockpit` + `apps/cockpit-api` inside hivescaler with strict adapter boundaries** ← chosen.

Option 3 gets monorepo benefits (one `pnpm dev`, free `@hivescaler/shared` and `@hivescaler/client` types, shared BetterAuth, existing Railway/Vercel pipelines) without baking "hivescaler is canonical" into the architecture. The discipline: **the cockpit treats hivescaler as one adapter among several, importing only `@hivescaler/client` and `@hivescaler/shared` — never reaching into `services/api` or `packages/platform` internals.**

If the cockpit later proves to be its own product, extracting from the monorepo is mechanical.

---

## Thesis

The bottleneck for a senior engineer running 10+ coding agents is not orchestration — it is **attention and decision throughput**. Existing tools each solve one slice (cloud execution, worktree isolation, observability, single-tool inboxes). None aggregate across surfaces or design for the supervisor's cognitive load.

Drawing from grand-strategy game UIs (Stellaris outliner, situation log), aviation (dark cockpit, master caution, GO/NO-GO), supervisory-control theory (Sheridan, Endsley), and recent practitioner literature on parallel agents (Willison, Litt, Cherny, Anthropic engineering), the cockpit is a dark, opinionated UI whose primary job is routing the operator's attention to the next decision that matters.

---

## Design principles (from the vision doc)

1. **Dark cockpit by default.** Healthy fleet = boring screen. Visual energy = abnormal. Two-stage attention grab (master caution glow → labelled annunciator).
2. **Notification → decision queue.** Display _decisions needing a human_, not events. Aged oldest-first. Top line glanceable: _"7 decisions, oldest 4h, 3 unblock 5 agents — fleet ok, $24/h burn."_
3. **Situation log > notification feed.** Long-running problems become durable objects with lifecycle, owner, SLA. Not transient timestamps.
4. **Decision ledger as canonical history.** Per-decision record: agent assumption, question, human decision, why, affected PR/commit/session.
5. **Per-capability autonomy.** Per-agent toggle row: edit code / push branch / open PR / merge / run migration / touch prod / spend over $X — each `allow / ask / never`.
6. **Grand-strategy framing, not StarCraft.** Stellaris/EU4 mental model dominates; StarCraft contributes micro (control groups, idle badges) only.
7. **Many isolated workstreams, not a swarm.** Each agent in worktree/sandbox. No real-time agent-to-agent coordination. Multi-agent reserved for read-only scout patterns.
8. **Measure ourselves.** Built-in metrics from day one as a hedge against the METR effect (19% slower while feeling 20% faster).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/cockpit (Vite + React 19 + R3F + TanStack Router)         │
│  apps/cockpit-api (Fastify + Drizzle + Postgres + Redis)        │
└──────┬──────────────────────────────────────────┬───────────────┘
       │ ingest                                   │ ingest
       │                                          │
┌──────▼──────────────────┐              ┌────────▼──────────────┐
│ Local adapters          │              │ Hivescaler adapter    │
│ - Claude Code (hooks)   │              │ - @hivescaler/client  │
│ - Codex CLI (stdio)     │              │ - SSE subscribe       │
│ - via git worktrees     │              │ - Message send-back   │
└─────────────────────────┘              └───────────────────────┘
                                                  │
                                                  ▼
                                         hivescaler platform
                                         (existing)
```

### Stack

- **Postgres + Drizzle** (not SQLite). Reasons:
  - Already the hivescaler standard; free schema-tooling reuse.
  - Multi-writer scenario inevitable once cloud adapters land.
  - Network-accessible for future mobile.
  - Cockpit migrations live in `packages/platform/src/schema/cockpit/` alongside platform schema, tracked via the same Drizzle migration runner. (Or a sibling migration namespace — TBD when scaffolding.)
- **Redis** (reuse existing). For pub/sub fan-out from ingest endpoints to WebSocket clients.
- **Fastify + WebSockets** for the cockpit-api. WS for live UI updates; REST for spawn/approve/block actions.
- **React 19 + R3F + Zustand** for the cockpit frontend. R3F for the portfolio map (3D); standard React for queue, outliner, situation log. TanStack Router/Query to match `apps/dashboard`. Tailwind.
- **ULIDs** everywhere (matches hivescaler convention).

### Why not Tauri/Electron yet

For the thin slice, a localhost web app is enough to test the queue hypothesis. Desktop notifications + global hotkeys are nice-to-have, not load-bearing. Revisit after v0.1.

### Why R3F (Three.js)

The portfolio-map / strategic-zoom idea (Supreme Commander style — wheel out to fleet, wheel in to a single transcript, no mode switch) is genuinely 3D-shaped. The visualiser project (`~/Projects/project-visualizer`) already proves this works with R3F + Zustand + WebSockets, with themes (Star Map, Circuit Board, City at Night) directly mappable to the portfolio map. Reuse the _shape_ of that project (dev script topology, store pattern, one theme as starting point) — do not import its content (GitHub collector, PR classifier, PCB autorouter).

Performance is not the bottleneck at ≤50 agents. Don't reach for Rust/Go.

---

## Adapter interface

All agent sources implement the same interface. The UI does not know or care which adapter spawned an event.

> **Design inspiration: Elixir/OTP actors.** Each session is conceptually a `GenServer` — its own state, its own mailbox, supervised independently. We're staying in TypeScript (the Agent SDK is TS-only and that's load-bearing), but the runtime is shaped to mirror the actor model so the patterns hold and a future port of just the agent-runtime layer is mechanical: one `SessionController` per session owning its SDK iterator and resolver map; cross-session communication only through the event bus (not direct calls); state-machine transitions live on the controller, not scattered across persistence/routes; resolver lookups are local to the controller, not in module-level maps. The `canUseTool` callback the controller awaits is the closest thing TS has to a `GenServer.call` blocking on its mailbox.

```typescript
interface AgentAdapter {
  readonly type: AgentType; // 'claude-code' | 'codex-cli' | 'hivescaler' | ...
  readonly capabilities: Capability[]; // what verbs this adapter supports

  spawn(spec: SpawnSpec): Promise<AgentSession>;
  attach(sessionId: string): AsyncIterable<NormalisedEvent>;
  send(sessionId: string, message: AgentMessage): Promise<void>;
  stop(sessionId: string): Promise<void>;
}
```

Three classes of adapter:

- **Local-process adapters** — `child_process` spawn of the user's installed `claude` CLI binary in a worktree, with hooks (`.claude/settings.json`) configured to POST events back to cockpit-api. Implemented in `apps/cockpit-api/src/adapters/claude-code/adapter.ts`. (Codex CLI adapter — stdio parsing — added in v0.2 once a non-CLI-binary reference exercises the abstraction.)
- **Hivescaler adapter** — `client.submitJob()` to spawn, `client.subscribe(jobId)` for events, `client.sendMessage()` to reply. Maps hivescaler `EventType` (`tool_call.started`, `response.text.delta`, etc.) → cockpit normalised events. Hivescaler containers run the Agent SDK (see `services/agent-images/anthropic`); decision-gating callbacks happen on the container side, surfaced upstream as events.
- **External cloud adapters** (Devin, Cursor BG, Copilot Coding Agent, Codex Cloud) — webhook-in, REST-out. **Deferred to v0.3+.**

### Local adapter mechanism: why CLI + hooks, not the Agent SDK

We almost shipped the Agent SDK as the local adapter. We backed out for one reason: **billing**.

- The `claude` CLI binary, when authenticated via `claude /login` or `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN`, consumes the user's **Pro/Max subscription tokens** (effectively free at the user's existing rate).
- The Agent SDK (`@anthropic-ai/claude-agent-sdk`, all versions through 0.2.120) **only accepts `ANTHROPIC_API_KEY`** and bills at API rates. Anthropic's Feb 2026 policy clarification explicitly forbids using subscription OAuth tokens with the SDK ([Agent SDK Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)).
- Our smoke test billed $0.26 for a trivial 4-turn session. At fleet scale (10+ parallel local agents) this turns the cockpit into a meaningful API expense for free what the CLI gives the user for free.
- The `pathToClaudeCodeExecutable` SDK option is a red herring — it changes which binary the SDK invokes, but the SDK still enforces API-key auth at the protocol layer.

So local agents use the CLI binary. We pay this price:

| What we lose vs. SDK                              | Mitigation                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canUseTool` async callback gating                | PreToolUse hook can return `{permissionDecision: 'deny', permissionDecisionReason: '...'}` to block. Cockpit holds the decision in the queue; on approve, hook script `exit 0`s; on block, it returns the deny payload. (v0.2 spike — Phase 1 just observes.) |
| Clean reply round-trip via `query()` input stream | `claude --resume <session-id>` + writing into the resumed session's stdin, OR PTY. (v0.2 spike.)                                                                                                                                                              |
| Structured `SDKMessage` stream                    | Hook payloads (PreToolUse / PostToolUse / Notification / Stop) carry the same data. We map them to the same `NormalisedEvent` shape.                                                                                                                          |
| Per-session permissionMode / model overrides      | Per-session `.claude/settings.json` injection (already done).                                                                                                                                                                                                 |

**The SDK adapter stays in the codebase** (`apps/cockpit-api/src/adapters/sdk/adapter.ts`) for future agent types that bill against API/LiteLLM keys — e.g., when we add `agentType: 'hivescaler-builder'` and want to drive a hivescaler-style container locally for testing without hitting the platform-API.

> **The exemption is about who owns the code, not where it runs.** Anthropic's policy treats third-party tools as third-party even when they run on the user's own machine. The CLI binary is exempt because it's a first-party Anthropic product; an SDK-driven cockpit is not, regardless of deployment topology.

### Decision sources

The cockpit listens to **three Claude Code hook surfaces** for three different purposes. Most tool calls produce no decision at all — the trigger classifier filters down to the ones a human should see.

| Surface                                      | Fires for                                                      | Cockpit use                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`PreToolUse` hook**                        | Every tool call the CLI is about to make                       | Classifier matches against destructive / secret / sensitive-path patterns. Match → write `cockpit_decision`. (v0.2: hook script blocks via `permissionDecision: 'deny'` while the decision is open in the queue, then `exit 0`s on approve.) |
| **`Notification` hook**                      | Agent volunteers a request for input ("I need clarification…") | Always severity `required`, trigger `scope-ambiguity`. Hook script blocks until human acts.                                                                                                                                                  |
| **`PostToolUse` hook + child stdout/stderr** | Every tool result + every line of model text                   | Persisted to `cockpit_events`. Drives portfolio-map activity, outliner status line, transcript view. (Cost is not surfaced via CLI hooks — v0.2 task to parse from claude session JSONL.)                                                    |

The classifier is the gate, not the hook surface itself. PreToolUse fires on every tool — we don't surface every fire as a decision.

For the **future SDK-based adapter** (cloud / API-billed agent types), the equivalent surfaces are `canUseTool` (callback returning `Promise<PermissionResult>` — we hold it while the decision is `open`), the `Notification` hook (same shape), and the `SDKMessage` stream. The same `NormalisedEvent` types flow either way.

### Trigger classification

Only specific signals become decisions. Everything else is status (live status line + persisted to event log).

| Trigger                        | Source signal                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Scope ambiguity                | `Notification` hook (agent explicitly asks)                                                                                 |
| Destructive action pending     | `PreToolUse` hook + classifier matches `rm -rf`, `git push --force`, migration commands, prod config                        |
| Architectural tradeoff         | Agent-flagged via prompt convention or hivescaler `tool_call` metadata                                                      |
| Failed validation              | `PostToolUse` hook with non-zero exit on tests/typecheck/build/lint                                                         |
| Merge conflict                 | Detected on PR open / push fail (later)                                                                                     |
| Security concern               | `PreToolUse` hook + classifier matches secret patterns or sensitive file paths                                              |
| Spend / time threshold crossed | hivescaler job metadata + cockpit policy. (Local CLI agents: cost not yet surfaced — v0.2 parse session JSONL transcripts.) |

Each trigger has a `severity` (info / advisory / required) and a default policy.

### Decision UX: cooldown timer + default + expand

Decision cards in the queue follow the airline-callout pattern, not a modal interrupt.

- **Question summary** (`cockpit_decisions.question`) — one line, glanceable.
- **Default choice** (new column `defaultChoice: 'approve' | 'block' | 'reply'`, plus optional `defaultReply`) — picked by the classifier from autonomy policy + severity. Highlighted button.
- **Cooldown bar** (new column `expiresAt: timestamp`) — thin progress bar across the bottom of the card draining over the cooldown interval. On expiry, the default applies and resolves the decision (which, for the SDK adapter, resolves the `canUseTool` Promise). **Hover pauses the bar** so engagement isn't penalised.
- **Expand** — click the card to grow into a panel showing the full event payload, recent transcript context, and all options including freeform reply.

Cooldown duration and behaviour are **per-trigger-type, not global**:

| Severity   | Trigger examples                                                        | Cooldown                              | Default                                 |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| `info`     | tool_progress milestone, cost crossed soft threshold                    | 30s                                   | dismiss (auto-resolve, no agent impact) |
| `advisory` | failed-validation on tests/typecheck                                    | 60s                                   | approve (agent continues)               |
| `required` | destructive-action, security-concern, scope-ambiguity from Notification | **no auto-expire** — must be answered |

Two operating modes (mode is a per-agent autonomy policy):

- **Pause-on-decision** (Phase 1 default): agent blocks while any decision is `open`. Cooldown expires → default applies → agent unblocks. Safe, slow.
- **Ride-through** (Phase 2): for `info`/`advisory` only — agent proceeds on the assumption the default is chosen. If the human picks differently before expiry, we issue a corrective `send()` (or for SDK adapter, a follow-up user message in the same session). Faster, only safe for non-blocking triggers.

The cooldown timer is also **the leading indicator from the metrics goal**: median age of cooldown remaining when the human acts. If it trends towards zero, we're rubber-stamping — the cockpit isn't routing attention, it's manufacturing busywork.

---

## Data model

New tables in Postgres. Naming convention: `cockpit_*` to keep separate from `platform_*` and auth tables.

| Table                       | Purpose                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `cockpit_projects`          | Local repo or hivescaler project the cockpit watches                           |
| `cockpit_workspaces`        | A worktree (local) or hivescaler job container (cloud)                         |
| `cockpit_agents`            | An agent instance: type, project, workspace, capabilities                      |
| `cockpit_sessions`          | Lifecycle of one agent session (state machine)                                 |
| `cockpit_decisions`         | Aged decision queue; FK to session; status, trigger_type, payload              |
| `cockpit_decision_ledger`   | Immutable record of every decision: assumption, question, choice, reason, refs |
| `cockpit_situations`        | Long-running problems with lifecycle, owner, SLA                               |
| `cockpit_metrics`           | Per-period counters: decisions/hour, blocked time, accepted-diff rate          |
| `cockpit_autonomy_policies` | Per-agent capability toggles (edit code / push / merge / etc.)                 |

Session state machine:
`queued → orienting → implementing → validating → blocked / needs-decision / ready-for-review → merged / stale-zombie`

The **decision ledger is the only persistent history the cockpit owns.** Transcripts stay in their underlying tools (Claude Code session files, hivescaler events table, etc.). The cockpit links out for replay.

### `cockpit_decisions` columns (additions for cooldown UX)

Beyond the base columns scaffolded in v0 (id, session, agent, event, trigger, severity, status, question, tool/command/file, payload, timestamps):

| Column          | Type      | Purpose                                                                                               |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `defaultChoice` | text      | `'approve' \| 'block' \| 'reply' \| 'dismiss'` — picked by classifier from autonomy policy + severity |
| `defaultReply`  | text      | Optional pre-filled reply text when `defaultChoice = 'reply'`                                         |
| `expiresAt`     | timestamp | When the cooldown bar runs out and `defaultChoice` is auto-applied. `null` for `required` severity.   |
| `mode`          | text      | `'pause-on-decision' \| 'ride-through'` — copied from agent autonomy policy at decision creation time |

In-process state (not persisted): each open decision linked to its held `canUseTool` resolver function, keyed by `decisionId`. Resolver fires when status flips to `approved` / `blocked` / `replied` / `expired`. Lost on cockpit-api restart → restart logic must scan for stale `open` decisions whose sessions no longer exist and mark them `expired`.

---

## Cockpit anatomy (UI)

Single screen, dark by default. From the vision doc:

```
┌──────────────────────────────────────────────────────────────────────┐
│  7 decisions, oldest 4h, 3 unblock 5 agents — fleet ok, $24/h burn   │
├────────────────────────────────────────────────────┬─────────────────┤
│                                                    │  OUTLINER       │
│           PORTFOLIO MAP (R3F)                      │                 │
│           territories / fronts / agent tiles       │  Project A      │
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

- **Top:** glanceable summary line. Always visible.
- **Center-left:** portfolio map (R3F). One tile per agent; colour = state, size = activity, opacity = staleness. Healthy = dim. Strategic zoom: wheel out to fleet, wheel in to single transcript.
- **Right rail:** outliner (Stellaris-style collapsible tree).
- **Center:** decision queue. One-click verbs (`approve`, `ask`, `block`, `template-reply`).
- **Bottom:** situation log.
- **Floating:** master caution glow when something abnormal.

Other surfaces deferred past v0.1: scenes, control groups, replay timeline, batched approvals, GO/NO-GO ceremonies, smart-ping radial.

---

## Spawning agents from the UI

A "Spawn Agent" modal:

1. Project selector (local repo or hivescaler project).
2. Agent type — flat list initially: `claude-code-local`, `codex-cli-local`, `hivescaler:builder`, `hivescaler:extractor`. Two-step (location → type) once the list grows.
3. Task description textarea.
4. Optional: branch name, autonomy policy preset.

Server flow:

- For local adapters: `git worktree add ../wt-{ulid} -b {branch}` → spawn child process → register `cockpit_workspace` + `cockpit_agent` + `cockpit_session` rows.
- For hivescaler adapter: `client.submitJob({ ... })` → register cockpit rows pointing to the hivescaler `jobId`.

In both cases, an agent tile appears on the portfolio map and events start flowing in.

---

## Phased plan

### Phase 0: Eval (½ day, recommended before code)

Hands-on with the closest existing tools to figure out which slices are already adequately solved:

- **Conductor** (conductor.build) — Mac worktree pattern.
- **Emdash** (emdash.sh) — closest existing implementation of the mental model.
- **Crystal** + **claude-squad** — OSS reference points.
- **LangChain Agent Inbox** — for the inbox UX.
- **AGDebugger** (github.com/microsoft/agdebugger) — for edit/reset interaction.

Output: a punch list of which v0.1 features are differentiated vs. table-stakes.

### Phase 1: Thin slice (3–4 days)

Goal: prove the queue + portfolio-map combo with one local + one cloud adapter.

1. **Scaffold `apps/cockpit` and `apps/cockpit-api`** as pnpm workspaces.
2. **Drizzle schema** for the cockpit tables (start with `projects`, `workspaces`, `agents`, `sessions`, `decisions`, `decision_ledger`). Migrations run alongside platform migrations.
3. **Adapter interface + two implementations:**
   - Claude Code CLI (local) — `child_process` spawn of `claude` in a worktree with `.claude/settings.json` hooks POSTing to cockpit-api. Subscription-billed via the user's `claude /login` auth. **(Done in current scaffold.)**
   - Hivescaler — SSE subscribe via `@hivescaler/client`; map events to normalised shape. (Hivescaler agents are SDK-based — see `services/agent-images/anthropic`. They bill against project API keys, which is correct for cloud.)
4. **Worktree service** for local adapters (`git worktree add` / `remove`). **(Done.)**
5. **Spawn modal** + REST endpoint for spawn flow. **(Done.)**
6. **Decision queue view** with `approve` / `block` / `reply` verbs, cooldown bar, default-choice highlight, expandable card. Phase 1: approve/block resolve the queue + write ledger; the running CLI session continues regardless (one-shot `claude -p`). Phase 2: hook-script-blocking gives true gating against the running session.
7. **Portfolio map (one theme)** — strip-down of project-visualiser's Star Map v2: one tile per agent, colour by state, pulse on activity. **(Done — driven by event stream.)**
8. **Top summary line** — decisions/oldest/required/live agents/fleet status. **(Done; cost surface deferred to v0.2 — needs JSONL transcript parsing for CLI mode.)**
9. **Auth via existing BetterAuth** — cockpit reuses the workspace/project auth model. (Phase 1 uses `wks_local` placeholder; wire BetterAuth before any non-local use.)

Already validated end-to-end on this branch: spawn → worktree → claude child → hooks → events → classifier → decision row → approve → ledger entry. SDK adapter exists in `apps/cockpit-api/src/adapters/sdk/` for future cloud-billed agent types but is not wired to `/spawn`.

Deferred from Phase 1:

- Codex CLI adapter (added in v0.2 — two adapters of different _classes_ is more valuable for the abstraction quality than two adapters of the same class on day one).
- Situation log, master caution, scenes, control groups, replay, autonomy policies UI, GitHub/Slack ingest, metrics dashboard, mobile.

### Phase 2 (v0.2): Codex CLI + situation log + autonomy policies UI

- **CLI gating spike**: `PreToolUse` hook script that returns `{permissionDecision: 'deny', permissionDecisionReason: '...'}` while a cockpit decision is `open`, and `exit 0`s on approve. Recovers most of the SDK's `canUseTool` ergonomics inside the cost-correct CLI path.
- **CLI reply round-trip spike**: `claude --resume <session-id>` + writing into the resumed session's stdin (or PTY). Removes the "approve does not unblock the agent" caveat in Phase 1.
- **CLI cost surfacing**: parse `~/.claude/projects/.../*.jsonl` session transcripts to extract usage/cost per session. Feed into the top summary line.
- Add Codex CLI adapter (stdio, similar to Claude Code shape).
- `cockpit_situations` table + bottom-row UI.
- Per-capability autonomy toggle row on agent detail.
- Master caution glow.
- **Cooldown UI**: progress bar across decision cards driven by `expiresAt`. Hover-pause. Default-choice highlighting.

### Phase 3 (v0.3): External cloud adapters + metrics

- Devin adapter (webhooks).
- Cursor BG, Copilot Coding Agent, Codex Cloud adapters.
- Metrics dashboard (decisions/hour, blocked time, accepted-diff rate, cost per merged PR).
- Mobile-optimised swipe triage.

### Phase 4+: Replay, GO/NO-GO, scenes, smart-ping radial, advanced

Lower priority until v0.3 metrics confirm the cockpit is helping.

---

## Open questions still to resolve

From the vision doc, with provisional answers:

1. **Single-user or multi-user from day one?** → Use BetterAuth's existing workspace/project model. Multi-user-capable; will be used as single-user initially.
2. **What's the canonical decision unit?** → For local CLI agents: a `PreToolUse` hook payload that the trigger classifier matches, or a `Notification` hook. For SDK-driven (cloud) agents: a held `canUseTool` callback or a `Notification` hook. For hivescaler agents: `tool_call.started` events that match policies. Plan checkpoints and PR reviews come later.
3. **Mobile-first or desktop-first?** → Desktop-first for v0.1 (real estate matters for the portfolio map). Mobile in v0.3.
4. **Where does cost live?** → Top summary line shows fleet $/h. Per-agent cost on detail view. Defer per-decision projection.
5. **How much agent history retained vs. linked?** → Decision ledger canonical. Transcripts link out. Replay deferred.
6. **Adapter strategy: read vs. write.** → Reads are easy. Writes are load-bearing for: (a) approving a Claude Code Notification, (b) sending a message to a hivescaler job, (c) commenting on a GitHub PR (v0.2+). Designed into the adapter interface from day one.
7. **Leading indicator the cockpit is helping.** → Median age of decision queue. If it goes up, the cockpit is making things worse.
8. **What happens when the human is offline?** → For v0.1, agents pause at any `ask` policy. Auto-pause everything = town bell mode in v0.2.

Cockpit-specific opens:

- **Cockpit migrations location.** ✅ Decided: separate `packages/cockpit-platform/`. Keeps cockpit extractable.
- **Naming.** "Cockpit" stuck for v0.1. Revisit before any external visibility.
- **Local adapter mechanism.** ✅ Decided: `claude` CLI binary spawned as a child process, with `.claude/settings.json` hooks POSTing to cockpit-api. The Agent SDK was evaluated and rejected for local agents because it cannot use subscription auth (Anthropic policy + technical: SDK requires `ANTHROPIC_API_KEY`). SDK adapter remains in the codebase for cloud / API-billed agent types. See "Local adapter mechanism" section above for the full rationale.
- **Session-terminal reuse.** `apps/web-api/src/routes/session-terminal.ts` may be useful when we move to PTY-mode `claude` to support reply round-trip in v0.2.

---

## Reuse map (what to take from the existing repo)

- **`@hivescaler/auth`** — workspace/project/membership model. Cockpit projects belong to workspaces.
- **`@hivescaler/client`** — hivescaler adapter built on this.
- **`@hivescaler/shared`** — types, IDs (ULIDs), enums.
- **`packages/platform`** Drizzle setup pattern — schema/migration tooling reused for `cockpit_*` tables.
- **`apps/dashboard`** structure — TanStack Router layout, Tailwind config, shadcn-style UI components, auth provider. Cockpit imports/copies UI primitives.
- **`apps/web-api`** Fastify setup — log config, CORS, auth middleware. Cockpit-api forks this.
- **`docker-compose.yml`** — Postgres + Redis already there.

What **not** to reuse:

- `services/api` (platform-API) internals — the cockpit-api is its own service.
- `services/agent-images` — cockpit doesn't ship containers.
- `packages/infra` — separate deploy concern for now.

What to reuse from the visualiser project (`~/Projects/project-visualizer`):

- Dev script topology (Vite + Fastify concurrently).
- R3F + Zustand + WebSocket pattern.
- One theme (Star Map v2) as starting point for portfolio map.

---

## Reference: vision doc

Full vision and research foundations in `~/Projects/kybernos/VISION.md`. Highlights:

- **Practitioner reading**: Willison "parallel coding agents", Cherny "how I use Claude Code", Anthropic "multi-agent research system", Litt "code like a surgeon", Karpathy 2025, Vincent "Superpowers", AGDebugger (CHI 2025).
- **Sober reading**: METR July 2025 RCT (19% slower / 20% faster-feeling), Cognition "Don't Build Multi-Agents", "Professional Software Developers Don't Vibe, They Control".
- **Pattern sources**: Stellaris/EU4 outliner + situation log, Supreme Commander strategic zoom, StarCraft control groups, Factorio off-screen pointers, RimWorld pause-on-event, LoL smart-ping radial, Airbus dark cockpit, NASA GO/NO-GO, ATC flight strips, ICU alarm fatigue, Sheridan supervisory control, Endsley situation awareness, Horvitz mixed-initiative, Shneiderman "overview first, zoom and filter, details on demand", Pirolli & Card information foraging, Weiser & Brown calm technology.

---

## Next session: where to pick up

1. Read this doc + `~/Projects/kybernos/VISION.md` (the vision).
2. Decide naming (cockpit-specific app name) and migrations package location.
3. Spike the Claude Code hook → reply round trip (30 minutes).
4. Decide on Phase 0 eval vs. straight to Phase 1.
5. If Phase 1: scaffold `apps/cockpit` + `apps/cockpit-api` + cockpit Drizzle package.
