# State of the system

*Snapshot 2026-04-26, end of phase 1. This file is a factual inventory:
what's actually built, what works end-to-end, what's deliberately stubbed,
what's known-rough. Update on any meaningful structural change. Distinct
from `phase-1-retro.md` (opinion + roadmap) and `VISION.md` (design
principles). Read this first when picking the project up cold.*

---

## What runs

A two-process app that supervises locally-spawned `claude` CLI agents and
surfaces decisions to a single human operator.

```
http://localhost:4400  apps/cockpit       Vite + React 19 + R3F + Tailwind
http://localhost:4500  apps/cockpit-api   Fastify + Drizzle + Postgres + Redis

Postgres on 5433       (docker compose)   creds swarm/swarm_dev/swarm
Redis on 6379          (docker compose)
```

Both run via `pnpm --filter @swarm/cockpit dev` and
`pnpm --filter @swarm/cockpit-api dev` respectively.

---

## Architecture in one diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  apps/cockpit  (browser, port 4400)                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Top: SummaryLine (annunciator + 4 instrument readouts)           │  │
│  │  Centre-left: PortfolioMap (R3F territories + tiles + drift orbit)│  │
│  │  Bottom-centre: DecisionQueue (command tiles + cooldowns)         │  │
│  │  Right rail: SessionOutliner (per-project session list + plan)    │  │
│  │  Floating: SessionDetail (transcript + decision-context block)    │  │
│  │  Floating: SpawnModal (MISSION BRIEF) / KeymapOverlay / Toasts    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                  ▲                          ▲                           │
│                  │ react-query              │ WebSocket /ws             │
│                  │ /sessions /decisions...  │ (live event/decision      │
│                  │                          │  invalidations)           │
└──────────────────┼──────────────────────────┼───────────────────────────┘
                   ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                apps/cockpit-api  (node, port 4500)                      │
│                                                                         │
│  Routes ─► /spawn /projects /sessions /sessions/:id/{events,message,    │
│            stop} /decisions /decisions/:id/{approve,block,reply}        │
│            /hooks/claude-code /hooks/verdict/:id /ws /health            │
│                                                                         │
│  Adapters ─► claude-code/  (DEFAULT — spawns `claude` CLI, hooks)       │
│              sdk/          (kept for future cloud-billed agents)        │
│                                                                         │
│  Runtime ─► SessionController  (one per live session — actor object)    │
│             event-bus          (in-process pub/sub)                     │
│             persistence       (writes events, rolls up tokens, classifies)│
│             cooldown-scheduler (Redis sorted-set BZPOPMIN consumer)     │
│             worktrees         (git worktree add/remove)                 │
│             orphan-sweep      (startup cleanup)                         │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼ child_process.spawn
                       ┌────────────────────────────────────┐
                       │ claude CLI in worktree             │
                       │ --input-format stream-json         │
                       │ --output-format stream-json        │
                       │ + .claude/settings.json hooks      │
                       │   (PreToolUse / PostToolUse /      │
                       │    PostToolUseFailure /            │
                       │    Notification / Stop)            │
                       └────────────────────────────────────┘
                                       │
                                       ▼ POST /hooks/claude-code
                                          (long-poll /hooks/verdict
                                           on PreToolUse for gating)
```

---

## Packages

| Package | Path | Role |
|---|---|---|
| `@swarm/cockpit` | `apps/cockpit` | React frontend (Vite, R3F, Tailwind, Zustand) |
| `@swarm/cockpit-api` | `apps/cockpit-api` | Fastify backend |
| `@swarm/core` | `packages/core` | Adapter contract types, normalised event types, trigger classifier. **No runtime deps** |
| `@swarm/platform` | `packages/platform` | Drizzle schema + migrations + db client |
| `@swarm/ids` | `packages/ids` | 7 ULID generators (built once, consumed compiled) |

`@swarm/ids` is the one package that actually compiles to `dist/` and is consumed
that way. Everything else is consumed via TS source through `tsx`/`vite`.

---

## Database

Postgres 16. Schema in `packages/platform/src/schema/`:

- `cockpit_projects` — repo or hivescaler-project being watched
- `cockpit_workspaces` — git worktree (or hivescaler container) the agent works in
- `cockpit_agents` — agent instance: type + workspace + capabilities
- `cockpit_sessions` — one agent run; columns include cumulative tokens, plan, cost
- `cockpit_events` — every NormalisedEvent (text deltas, tool.pre/post, plan.updated, cost.updated, etc.)
- `cockpit_decisions` — aged decision queue with cooldown columns
- `cockpit_decision_ledger` — append-only audit trail of resolved decisions

Migrations live in `packages/platform/drizzle/`:
- `0000_dear_stark_industries.sql` — initial schema
- `0001_loving_mongu.sql` — cooldown columns (defaultChoice, defaultReply, expiresAt, mode)
- `0002_free_gorgon.sql` — cockpit_sessions.currentTodos
- `0003_worried_penance.sql` — token rollup columns (cumulativeInputTokens, cumulativeCostUsd, contextWindow)

Migration table: `__drizzle_migrations_cockpit` (deliberate namespace separation
from the previous monorepo's platform migrations, even though that's no longer
relevant in the standalone repo).

Apply with `pnpm --filter @swarm/platform db:migrate`. Generate new ones with
`pnpm --filter @swarm/platform db:generate` after editing schema.

---

## Adapters: the most important architectural decision

There are two adapters in the codebase. **Only the CLI one is wired to `/spawn`.**

### `apps/cockpit-api/src/adapters/claude-code/` — DEFAULT

Spawns the `claude` CLI binary as a child process inside a worktree, with
`.claude/settings.json` injecting hooks that POST back to the api.

- **Subscription auth** — uses your `claude /login` token, no `ANTHROPIC_API_KEY`,
  no per-token billing for the user.
- Streaming: `claude --input-format stream-json --output-format stream-json
  --print --verbose --include-partial-messages`. Stdin stays open across turns
  so `send()` can push follow-up user messages.
- Gating: PreToolUse hook script POSTs to `/hooks/claude-code`, gets back either
  `{verdict:'allow'}` (proceed) or `{decisionId}` (then long-polls
  `/hooks/verdict/:id` until human acts; pause is real).
- PostToolUseFailure registered separately (Claude Code fires this, not
  PostToolUse, when a Bash command exits non-zero — without this, npm test
  failures never produce decisions).

### `apps/cockpit-api/src/adapters/sdk/` — NOT wired by default

Built first, then deliberately backed out. Uses `@anthropic-ai/claude-agent-sdk`
with `systemPrompt: { preset: 'claude_code' }`. Cleaner gating model (`canUseTool`
is an async callback that *is* the reply round-trip), but **only accepts
`ANTHROPIC_API_KEY`** — bills at API rates. Anthropic's Feb 2026 policy
clarification explicitly forbids using OAuth subscription tokens with the SDK
in third-party tools.

Kept in the codebase because:
- It's the right adapter shape for future cloud-billed agent types (e.g. when
  we add hivescaler containers driven from the cockpit, those containers run
  their own SDK against a project API key).
- It exercises the abstraction in `@swarm/core` so the `AgentAdapter` interface
  isn't tested by only one implementation.

If you re-discover this and think "we should use the SDK", read
`COCKPIT_PLAN.md` "Local adapter mechanism" section first — the trade-off
research is documented in detail.

---

## What works end-to-end (validated by hand)

- Spawn local agent → fresh git worktree under `~/.cockpit-worktrees/{repo}/ckws_…`,
  `.claude/settings.json` injected, `claude` child started with the task as
  initial user message
- Claude streams response → text deltas appear in session detail; cost/turns
  surface in stat row; TodoWrite calls promote to `plan.updated` events and
  `cumulativeInputTokens` rolls up
- PreToolUse → if classifier matches (destructive command, sensitive file, secret
  pattern), decision created, hook script blocks waiting for verdict, annunciator
  + master caution + queue card all light up
- Approve → hook returns `{permissionDecision:'allow'}`, claude executes the
  tool, session continues
- Block → hook returns `{permissionDecision:'deny',reason:...}`, claude sees the
  deny and adapts (typically apologises and stops)
- Reply → same as block but the deny reason carries the operator's message
- PostToolUseFailure (e.g. `npm test` exit 1 in a repo with a failing test) →
  `failed-validation` advisory decision, 60s cooldown bar, default `approve` on
  expiry
- `/sessions/:id/message` → push follow-up user message into a live streaming
  session (no need to wait for a gating decision)
- `/sessions/:id/stop` → SIGTERMs the claude child, marks row stopped
- Orphan sweep on api startup → marks any non-terminal sessions with no
  endedAt as `stale-zombie` (so a previous api crash doesn't leave the map
  showing dead agents as live)
- Live event firehose → WebSocket `/ws` broadcasts every event + decision
  lifecycle to all connected browsers; react-query invalidation keeps the UI
  in sync without polling

---

## Known rough / unresolved

- **Detail panel covers the dollied-in tile partially.** Camera dollies to a
  position biased right of the tile so the panel doesn't fully obscure it,
  but the panel still floats over part of the tile. Discussed; not fixed.
- **The outliner duplicates information already on the map.** We had a long
  discussion mid-build about killing it or repurposing it as a real situation
  log. Punted. The outliner remains a flat per-project session list.
- **Decision queue layout vs map dominance.** Queue lives below the map at
  the moment, growing with depth. Discussed moving it to the right rail
  (instead of outliner). Punted.
- **The `LOAD` readout is real (live/total agent count) but the per-turn
  "tokens ≈$X" label** in the session detail header is a token-equivalent
  denominator from the CLI's `total_cost_usd` field — not actual money out
  of pocket on subscription. Tooltip explains this; UI is honest about it.
- **No filter / no scenes / no control groups.** Vision called these out;
  none are built. Map shows all live agents; queue shows all open decisions.
  At fleet scale with 30+ agents this will hurt; with 5-10 it's fine.
- **Lifecycle hygiene is robust but coarse.** Stopping a session SIGTERMs
  the child but doesn't clean up the worktree. `~/.cockpit-worktrees/`
  accumulates.
- **No real metrics.** Events/min sparkline + token-load. None of the
  vision's principle-8 metrics (decisions/hour, blocked time, accepted-diff
  rate, abandoned sessions, cost per merged PR). See `phase-1-retro.md`
  Track A — this is the highest priority phase 2 work.
- **No per-capability autonomy.** Every gate routes through the same
  classifier with the same severity defaults. See `phase-1-retro.md`
  Track A.

---

## Operational notes

- **Worktree location.** Spawned agents get a worktree under
  `~/.cockpit-worktrees/{repo-name}/ckws_{ulid}/`. The `.cockpit/` and
  `.claude/` directories inside hold per-session hook script + claude config.
  Never commit these dirs from the worktree back to the repo.
- **Cleaning worktrees.** `git worktree remove --force` from the source repo,
  or `rm -rf ~/.cockpit-worktrees/{repo}/ckws_*` plus
  `git -C {source-repo} worktree prune` to clean the registry. The repo
  shipped with a script for this previously; not currently in tree.
- **Postgres port 5433.** Deliberately non-standard so it doesn't conflict
  with a system Postgres on 5432.
- **The hook script POSTs to `127.0.0.1:4500` by default.** If you ever run
  cockpit-api on a different host (e.g. dockerised), set
  `COCKPIT_API_PUBLIC_HOST` so the hook script can reach it.
- **Claude CLI auth.** The `claude` CLI must be logged in (`claude /login`)
  before spawning agents — it's the agent's own auth context. Cockpit-api
  doesn't broker auth, the child processes inherit the user's environment.
- **Cost reality check.** With subscription auth, you don't pay per-token.
  But you DO consume your subscription's rate-limit window. Heavy use
  (10+ agents pumping tokens) can hit Pro/Max limits.

---

## File map (for cold reading)

If you're picking this up and want to grok the runtime fast, read in this order:

1. `apps/cockpit-api/src/index.ts` — entry, what's wired
2. `apps/cockpit-api/src/runtime/SessionController.ts` — the per-session actor object
3. `apps/cockpit-api/src/adapters/claude-code/adapter.ts` — how an agent is spawned + hooked
4. `apps/cockpit-api/src/routes/hooks.ts` — the gating round-trip
5. `apps/cockpit-api/src/lib/persistence.ts` — events → rows + classify → decisions
6. `packages/core/src/triggers.ts` — what gets gated and why
7. `apps/cockpit/src/App.tsx` — frontend layout
8. `apps/cockpit/src/scene/PortfolioMap.tsx` — the 3D map
9. `apps/cockpit/src/components/SessionDetail.tsx` — the floating inspector window

Then read `COCKPIT_PLAN.md` for the architectural rationale, and
`docs/phase-1-retro.md` for what to do next.

---

## Last verified

- 2026-04-26. End of phase 1, immediately after extraction from hivescaler.
- All packages typecheck clean. Frontend builds.
- Manually validated: spawn → gate → approve → continue (subscription billing).
- Manually validated: spawn → npm test failure → cooldown card → 60s drain → auto-approve.
- Manually validated: stop button kills the claude child, row marked stopped.

If you're reading this *after* phase 2 work has started, this snapshot is
stale. Re-verify the "Known rough" and "What works" sections before relying
on either.
