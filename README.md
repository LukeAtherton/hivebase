# Swarm

A supervision cockpit for one human commanding 10+ AI coding agents in parallel.

> The bottleneck for a senior engineer running parallel coding agents isn't
> orchestration — it's **attention and decision throughput**. Swarm is the
> missing layer above existing agent surfaces (Claude Code, Devin, Cursor BG,
> hivescaler) whose primary job is routing the operator's attention to the
> next decision that matters.

## Reading order

- [`VISION.md`](VISION.md) — research synthesis and design principles. Why this exists, what it isn't, the academic foundations (Sheridan, Endsley, Horvitz, Mark, Pirolli, Lee & See).
- [`COCKPIT_PLAN.md`](COCKPIT_PLAN.md) — phase-1 architecture and implementation plan.
- [`cockpit-iteration-log.md`](cockpit-iteration-log.md) — running journal of build cycles, what was tried, what changed.
- [`docs/phase-1-retro.md`](docs/phase-1-retro.md) — retrospective on the first build phase, mapped back to the academic frame.

## What's here

```
apps/cockpit         — Vite + React 19 + R3F frontend (port 4400)
apps/cockpit-api     — Fastify backend (port 4500)
packages/core        — adapter contract types + trigger classifier
packages/platform    — Drizzle schema + migrations
packages/ids         — ULID generators
```

## Run it locally

You need Docker (for Postgres + Redis), Node 22+, pnpm, and a logged-in
`claude` CLI (subscription auth — the cockpit doesn't bill API tokens).

```bash
# 1. Bring up Postgres (port 5433) + Redis (port 6379)
docker compose up -d

# 2. Install deps
pnpm install

# 3. Build the workspace packages once
pnpm -r build

# 4. Apply Drizzle migrations
pnpm --filter @swarm/platform db:migrate

# 5. In one terminal — backend on :4500
pnpm --filter @swarm/cockpit-api dev

# 6. In another — frontend on :4400
pnpm --filter @swarm/cockpit dev
```

Open `http://localhost:4400`.

## Auth note

The local-agent adapter spawns the `claude` CLI in stream-json mode and inherits
your existing `claude /login` subscription auth — no `ANTHROPIC_API_KEY`, no
per-token billing. The Agent SDK adapter (in `apps/cockpit-api/src/adapters/sdk/`)
exists for future cloud / API-billed agent types but is not the default.

## Status

Phase 1 (in-monorepo build) shipped: dark-cockpit aesthetic, territorial 3D
portfolio map, instrument top bar with annunciator, command-tile decision queue
with cooldowns, MISSION BRIEF spawn surface, persistent outliner, floating
session detail with decision-context block, gating round-trip, reply round-trip,
keymap, master caution, lifecycle hygiene. See `COCKPIT_PLAN.md` and
`cockpit-iteration-log.md` for the full picture.

Phase 2 is being scoped in `docs/phase-1-retro.md` against the academic
foundations.
