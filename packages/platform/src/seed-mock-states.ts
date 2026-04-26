/**
 * Deterministic mock-data seed for UX-audit snapshots.
 *
 * Wipes cockpit_* tables and writes a fixed dataset covering every
 * view-state we want to capture for the audit canvas. Reproducible:
 * fixed IDs, fixed timestamps relative to a single `NOW` constant.
 *
 * Usage:
 *   pnpm tsx scripts/seed-mock-states.ts
 *
 * Refuses to run unless DATABASE_URL points at the local docker
 * compose Postgres (port 5433). Hard-coded guard — this drops data.
 */
import { sql } from 'drizzle-orm';
import { closeCockpitDb, getCockpitDb } from './client.js';
import * as schema from './schema/index.js';

const NOW = new Date('2026-04-26T13:00:00.000Z');
const ms = (offsetSeconds: number) =>
  new Date(NOW.getTime() + offsetSeconds * 1000).toISOString();

// ---------- Guard ----------

function assertSafeDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  // Refuse to run against anything that doesn't look like our local docker.
  // 5433 is the deliberately-non-standard local port.
  if (!url.includes(':5433/') || !url.includes('swarm')) {
    throw new Error(
      `Refusing to seed: DATABASE_URL must point at the local docker Postgres (got: ${url}).`,
    );
  }
}

// ---------- Fixed IDs ----------
//
// All IDs are deterministic. Re-running the seed produces the same
// world. This means we can refer to specific sessions/decisions by
// id from snapshot-capture scripts.

const W = 'wks_local';
const P = {
  pulse: 'ckpr_seed_pulse_____________',
  atlas: 'ckpr_seed_atlas_____________',
  tally: 'ckpr_seed_tally_____________',
};
const WS = (n: number) => `ckws_seed_${String(n).padStart(2, '0')}_____________`;
const A = (n: number) => `ckag_seed_${String(n).padStart(2, '0')}_____________`;
const S = (n: number) => `ckse_seed_${String(n).padStart(2, '0')}_____________`;
const D = (n: number) => `ckde_seed_${String(n).padStart(2, '0')}_____________`;
const E = (n: number) => `ckev_seed_${String(n).padStart(4, '0')}___________`;

// ---------- The world ----------
//
// Three projects, ten sessions across them, covering every named
// state we want a snapshot of.

const projects = [
  {
    cockpitProjectId: P.pulse,
    workspaceId: W,
    name: 'pulse',
    kind: 'local-repo',
    repoPath: '/Users/lukeatherton/Projects/pulse',
    metadata: {},
    createdAt: ms(-86400 * 14),
    createdBy: 'me',
  },
  {
    cockpitProjectId: P.atlas,
    workspaceId: W,
    name: 'atlas',
    kind: 'local-repo',
    repoPath: '/Users/lukeatherton/Projects/atlas',
    metadata: {},
    createdAt: ms(-86400 * 9),
    createdBy: 'me',
  },
  {
    cockpitProjectId: P.tally,
    workspaceId: W,
    name: 'tally',
    kind: 'local-repo',
    repoPath: '/Users/lukeatherton/Projects/tally',
    metadata: {},
    createdAt: ms(-86400 * 30),
    createdBy: 'me',
  },
];

interface SeedSession {
  ix: number;
  project: string;
  label: string;
  task: string;
  state: string;
  startedSecondsAgo: number;
  lastEventSecondsAgo: number;
  cumulativeInputTokens: number;
  cumulativeCostUsd: number;
  contextWindow: number;
  todos?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  events?: Array<{ type: string; payload: Record<string, unknown>; tSecondsAgo: number }>;
  decisions?: Array<{
    ix: number;
    triggerType: string;
    severity: 'info' | 'advisory' | 'required';
    status: 'open' | 'approved' | 'blocked' | 'replied' | 'expired';
    question: string;
    detail?: string;
    evidenceLines?: string[];
    rejectOptions?: Array<{ id: string; label: string; reply: string }>;
    toolName?: string;
    command?: string;
    filePath?: string;
    payload?: Record<string, unknown>;
    defaultChoice?: 'approve' | 'block' | 'reply' | 'dismiss';
    defaultReply?: string;
    expiresInSeconds?: number | null; // relative to NOW; null => no expiry
    createdSecondsAgo: number;
    resolvedSecondsAgo?: number;
  }>;
}

// Sessions are chosen to populate every view-state on the canvas:
//
//  S1  pulse  HEALTHY-IMPLEMENTING       — calm tile, no decision
//  S2  pulse  ADVISORY-COOLDOWN-ACTIVE   — npm test failed, draining cooldown
//  S3  pulse  REQUIRED-DESTRUCTIVE       — rm -rf, no expiry, master caution red
//  S4  atlas  REQUIRED-SECURITY          — write to .env, master caution red
//  S5  atlas  SCOPING-IN-PROGRESS        — read-only, drafting artifact
//  S6  atlas  VERIFICATION-READY         — agent done, awaiting human review
//  S7  tally  STALE-WAITING              — required decision open >30min
//  S8  tally  HIGH-CONTEXT-PRESSURE      — implementing but ~85% of context window
//  S9  tally  STOPPED                    — operator halted earlier
//  S10 pulse  RECENTLY-RESOLVED-CALM     — decision approved 2 min ago, agent continuing
const sessions: SeedSession[] = [
  // --- S1 healthy implementing ---
  {
    ix: 1,
    project: P.pulse,
    label: 'profile route refactor',
    task: 'Refactor /api/profile to use the new auth middleware. Keep response shape identical.',
    state: 'implementing',
    startedSecondsAgo: 60 * 18,
    lastEventSecondsAgo: 8,
    cumulativeInputTokens: 41_300,
    cumulativeCostUsd: 0.12,
    contextWindow: 200_000,
    todos: [
      { content: 'Map current /api/profile to new auth middleware', status: 'completed' },
      { content: 'Update controller signature', status: 'in_progress' },
      { content: 'Run integration tests', status: 'pending' },
      { content: 'Open PR with before/after', status: 'pending' },
    ],
    events: [
      { type: 'text.delta', payload: { text: 'Reading routes/profile.ts...' }, tSecondsAgo: 60 * 18 },
      { type: 'tool.pre', payload: { toolName: 'Read', filePath: 'src/routes/profile.ts' }, tSecondsAgo: 60 * 17 },
      { type: 'tool.post', payload: { toolName: 'Read', exitCode: 0 }, tSecondsAgo: 60 * 17 },
      { type: 'plan.updated', payload: { todos: 4 }, tSecondsAgo: 60 * 16 },
      { type: 'text.delta', payload: { text: 'Updating controller signature...' }, tSecondsAgo: 60 * 2 },
      { type: 'cost.updated', payload: { cumulativeCostUsd: 0.12 }, tSecondsAgo: 8 },
    ],
  },
  // --- S2 advisory cooldown active ---
  {
    ix: 2,
    project: P.pulse,
    label: 'order-history pagination',
    task: 'Add cursor-based pagination to /api/orders/history.',
    state: 'needs-decision',
    startedSecondsAgo: 60 * 11,
    lastEventSecondsAgo: 30,
    cumulativeInputTokens: 22_400,
    cumulativeCostUsd: 0.07,
    contextWindow: 200_000,
    todos: [
      { content: 'Implement cursor encoder/decoder', status: 'completed' },
      { content: 'Update query in repository', status: 'completed' },
      { content: 'Add unit tests', status: 'in_progress' },
    ],
    decisions: [
      {
        ix: 1,
        triggerType: 'failed-validation',
        severity: 'advisory',
        status: 'open',
        question: 'test failed — retry, change approach, or block?',
        detail: 'Agent ran `pnpm test src/routes/orders.test.ts` (exit 1).',
        evidenceLines: [
          'FAIL  src/routes/orders.test.ts',
          '  ● cursor pagination › decodes cursor',
          '  Expected offset 20, received 21',
        ],
        rejectOptions: [
          { id: 'retry', label: 'retry as-is', reply: 'Try again with the same approach.' },
          { id: 'change-approach', label: 'change approach', reply: "Pause — let's rethink this; explain the alternatives before proceeding." },
          { id: 'skip', label: 'skip this check', reply: 'Skip this check for now and continue.' },
        ],
        toolName: 'Bash',
        command: 'pnpm test src/routes/orders.test.ts',
        payload: {
          stderr: 'FAIL  src/routes/orders.test.ts\n  ● cursor pagination › decodes cursor\n\n    expect(received).toEqual(expected)\n    Expected: { id: "ord_42", offset: 20 }\n    Received: { id: "ord_42", offset: 21 }',
        },
        defaultChoice: 'approve',
        expiresInSeconds: 28, // ~half-drained 60s cooldown
        createdSecondsAgo: 32,
      },
    ],
    events: [
      { type: 'tool.pre', payload: { toolName: 'Bash', command: 'pnpm test src/routes/orders.test.ts' }, tSecondsAgo: 50 },
      { type: 'tool.post', payload: { toolName: 'Bash', exitCode: 1, stderr: 'FAIL ...' }, tSecondsAgo: 32 },
    ],
  },
  // --- S3 required destructive (master caution RED) ---
  {
    ix: 3,
    project: P.pulse,
    label: 'cleanup tmp dirs',
    task: 'Clean up the orphaned tmp/ directories under packages/.',
    state: 'needs-decision',
    startedSecondsAgo: 60 * 6,
    lastEventSecondsAgo: 60,
    cumulativeInputTokens: 12_900,
    cumulativeCostUsd: 0.03,
    contextWindow: 200_000,
    decisions: [
      {
        ix: 2,
        triggerType: 'destructive-action',
        severity: 'required',
        status: 'open',
        question: 'Approve recursive delete?',
        detail: 'Agent intends to drop orphaned tmp/ subdirs across packages — six matched.',
        evidenceLines: [
          '$ rm -rf packages/*/tmp',
          'matched: packages/core/tmp, packages/platform/tmp, packages/ids/tmp, +3 more',
        ],
        rejectOptions: [
          { id: 'too-broad', label: 'too broad — narrow it', reply: 'Stop. The scope is too wide; narrow the target list and re-ask.' },
          { id: 'wrong-approach', label: 'change approach', reply: "Don't do this; pick a non-destructive alternative." },
        ],
        toolName: 'Bash',
        command: 'rm -rf packages/*/tmp',
        payload: {
          rationale: 'agent intends to drop orphaned tmp/ subdirs across packages — six matched',
        },
        defaultChoice: 'block',
        expiresInSeconds: null,
        createdSecondsAgo: 60,
      },
    ],
    events: [
      { type: 'tool.pre', payload: { toolName: 'Bash', command: 'find packages -type d -name tmp' }, tSecondsAgo: 90 },
      { type: 'tool.post', payload: { toolName: 'Bash', exitCode: 0 }, tSecondsAgo: 75 },
      { type: 'tool.pre', payload: { toolName: 'Bash', command: 'rm -rf packages/*/tmp' }, tSecondsAgo: 60 },
    ],
  },
  // --- S4 required security (sensitive path) ---
  {
    ix: 4,
    project: P.atlas,
    label: 'env var audit',
    task: 'Audit which env vars are read in services/ and prune the .env.example accordingly.',
    state: 'needs-decision',
    startedSecondsAgo: 60 * 22,
    lastEventSecondsAgo: 60 * 2,
    cumulativeInputTokens: 38_100,
    cumulativeCostUsd: 0.11,
    contextWindow: 200_000,
    decisions: [
      {
        ix: 3,
        triggerType: 'security-concern',
        severity: 'required',
        status: 'open',
        question: 'Approve write to sensitive path .env.example?',
        detail: 'Agent wants to remove DEPRECATED_API_KEY and STRIPE_TEST_SECRET, and add EVENT_BUS_URL.',
        evidenceLines: ['path: .env.example'],
        rejectOptions: [
          { id: 'redirect', label: 'edit elsewhere', reply: "Don't edit .env.example; use the example/template file instead." },
          { id: 'explain', label: 'explain why', reply: 'Explain why this edit to .env.example is needed before proceeding.' },
        ],
        toolName: 'Edit',
        filePath: '.env.example',
        payload: {
          intent: 'remove DEPRECATED_API_KEY and STRIPE_TEST_SECRET, add EVENT_BUS_URL',
        },
        defaultChoice: 'block',
        expiresInSeconds: null,
        createdSecondsAgo: 60 * 2,
      },
    ],
    events: [
      { type: 'tool.pre', payload: { toolName: 'Read', filePath: '.env.example' }, tSecondsAgo: 60 * 3 },
      { type: 'tool.pre', payload: { toolName: 'Edit', filePath: '.env.example' }, tSecondsAgo: 60 * 2 },
    ],
  },
  // --- S5 scoping in progress (NEW STAGE — proposed mock) ---
  // No real schema for stage yet; encode as 'orienting' state with a metadata
  // marker. Front-end can read this in mock mode to render the scoping surface.
  {
    ix: 5,
    project: P.atlas,
    label: 'webhook delivery overhaul',
    task: 'Plan an overhaul of the webhook delivery system. Investigate, do not implement yet.',
    state: 'orienting',
    startedSecondsAgo: 60 * 9,
    lastEventSecondsAgo: 12,
    cumulativeInputTokens: 18_700,
    cumulativeCostUsd: 0.06,
    contextWindow: 200_000,
    todos: [
      { content: 'Read services/webhooks/delivery.ts', status: 'completed' },
      { content: 'Trace retry/backoff path', status: 'completed' },
      { content: 'Map current failure modes', status: 'in_progress' },
      { content: 'Draft scope artifact', status: 'pending' },
    ],
    events: [
      { type: 'text.delta', payload: { text: "I've read services/webhooks/delivery.ts (line 1–340) and the retry path in queue.ts." }, tSecondsAgo: 60 * 7 },
      { type: 'tool.pre', payload: { toolName: 'Read', filePath: 'services/webhooks/delivery.ts' }, tSecondsAgo: 60 * 8 },
      { type: 'text.delta', payload: { text: 'There seem to be three failure modes: stale signatures (no rotation), poisoned retries (no DLQ), and connection-pool exhaustion under spike load. Should we tackle all three or prioritise the DLQ since it has caused two recent incidents?' }, tSecondsAgo: 60 * 3 },
      { type: 'cost.updated', payload: { cumulativeCostUsd: 0.06 }, tSecondsAgo: 12 },
    ],
  },
  // --- S6 verification ready ---
  {
    ix: 6,
    project: P.atlas,
    label: 'rate limiter middleware',
    task: 'Implement IP-based rate limiter middleware per spec at docs/rate-limit.md.',
    state: 'ready-for-review',
    startedSecondsAgo: 60 * 47,
    lastEventSecondsAgo: 60 * 2,
    cumulativeInputTokens: 76_500,
    cumulativeCostUsd: 0.21,
    contextWindow: 200_000,
    todos: [
      { content: 'Implement TokenBucket', status: 'completed' },
      { content: 'Wire as Fastify middleware', status: 'completed' },
      { content: 'Tests for window edges', status: 'completed' },
      { content: 'Update docs', status: 'completed' },
    ],
    events: [
      { type: 'text.delta', payload: { text: 'All four todos complete. Tests green (12 pass, 0 fail). Diff touches 4 files within the agreed scope.' }, tSecondsAgo: 60 * 2 },
      { type: 'cost.updated', payload: { cumulativeCostUsd: 0.21 }, tSecondsAgo: 60 * 2 },
    ],
  },
  // --- S7 stale waiting (decision >30min old, no resolution) ---
  {
    ix: 7,
    project: P.tally,
    label: 'replace deprecated dep',
    task: 'Replace usage of `moment` with `date-fns`. ~40 call sites.',
    state: 'needs-decision',
    startedSecondsAgo: 60 * 95,
    lastEventSecondsAgo: 60 * 38,
    cumulativeInputTokens: 47_200,
    cumulativeCostUsd: 0.14,
    contextWindow: 200_000,
    decisions: [
      {
        ix: 4,
        triggerType: 'scope-ambiguity',
        severity: 'required',
        status: 'open',
        question: 'Three call sites use `moment.tz` — date-fns-tz is a separate package. Add it, or refactor those three to use the platform Intl API?',
        detail: 'Agent paused to ask for direction on timezone handling.',
        evidenceLines: [
          'services/scheduler/cron.ts:42',
          'services/reports/timezone.ts:18',
          'apps/web/src/lib/locale.ts:91',
        ],
        // Direction questions are dialog-shaped — freeform reply fits better
        // than templated rejects.
        payload: {
          callSites: [
            'services/scheduler/cron.ts:42',
            'services/reports/timezone.ts:18',
            'apps/web/src/lib/locale.ts:91',
          ],
        },
        defaultChoice: undefined,
        expiresInSeconds: null,
        createdSecondsAgo: 60 * 38,
      },
    ],
    events: [
      { type: 'tool.pre', payload: { toolName: 'Grep', command: 'rg "moment\\." -l' }, tSecondsAgo: 60 * 90 },
      { type: 'notification', payload: { message: 'Three call sites use moment.tz; choose strategy before continuing.' }, tSecondsAgo: 60 * 38 },
    ],
  },
  // --- S8 high context pressure ---
  {
    ix: 8,
    project: P.tally,
    label: 'long-running migration',
    task: 'Migrate the legacy reporting pipeline to the new event bus. Multi-step.',
    state: 'implementing',
    startedSecondsAgo: 60 * 145,
    lastEventSecondsAgo: 4,
    cumulativeInputTokens: 168_500,
    cumulativeCostUsd: 0.62,
    contextWindow: 200_000,
    todos: [
      { content: 'Audit current pipeline producers', status: 'completed' },
      { content: 'Map to new bus topics', status: 'completed' },
      { content: 'Migrate producer A', status: 'completed' },
      { content: 'Migrate producer B', status: 'in_progress' },
      { content: 'Migrate producer C', status: 'pending' },
      { content: 'Cutover + remove legacy', status: 'pending' },
    ],
    events: [
      { type: 'text.delta', payload: { text: 'Producer A migrated, tests green. Moving to producer B...' }, tSecondsAgo: 60 * 8 },
      { type: 'cost.updated', payload: { cumulativeCostUsd: 0.62 }, tSecondsAgo: 4 },
    ],
  },
  // --- S9 stopped ---
  {
    ix: 9,
    project: P.tally,
    label: 'log dedup spike',
    task: 'Spike on deduplicating noisy logs in services/api.',
    state: 'stopped',
    startedSecondsAgo: 60 * 60 * 3,
    lastEventSecondsAgo: 60 * 60 * 2,
    cumulativeInputTokens: 31_000,
    cumulativeCostUsd: 0.08,
    contextWindow: 200_000,
    events: [
      { type: 'text.delta', payload: { text: 'Spike abandoned per operator instruction.' }, tSecondsAgo: 60 * 60 * 2 },
    ],
  },
  // --- S10 recently-resolved calm (closed decision in last 2 minutes) ---
  {
    ix: 10,
    project: P.pulse,
    label: 'feature flag cleanup',
    task: 'Remove the `experimental_dark_mode` flag everywhere.',
    state: 'implementing',
    startedSecondsAgo: 60 * 25,
    lastEventSecondsAgo: 6,
    cumulativeInputTokens: 33_900,
    cumulativeCostUsd: 0.09,
    contextWindow: 200_000,
    decisions: [
      {
        ix: 5,
        triggerType: 'failed-validation',
        severity: 'advisory',
        status: 'approved',
        question: 'pnpm typecheck failed (exit 2)',
        toolName: 'Bash',
        command: 'pnpm typecheck',
        defaultChoice: 'approve',
        expiresInSeconds: -1, // already past
        createdSecondsAgo: 60 * 3,
        resolvedSecondsAgo: 60 * 2,
      },
    ],
    events: [
      { type: 'tool.pre', payload: { toolName: 'Bash', command: 'pnpm typecheck' }, tSecondsAgo: 60 * 4 },
      { type: 'tool.post', payload: { toolName: 'Bash', exitCode: 2 }, tSecondsAgo: 60 * 3 },
      { type: 'text.delta', payload: { text: 'After fix: typecheck green.' }, tSecondsAgo: 60 * 1 },
      { type: 'cost.updated', payload: { cumulativeCostUsd: 0.09 }, tSecondsAgo: 6 },
    ],
  },
];

// ---------- Insertion ----------

async function seed() {
  assertSafeDatabase();
  const db = getCockpitDb();

  // Wipe in dependency order.
  console.log('Wiping cockpit_* tables…');
  await db.delete(schema.cockpitDecisionLedger);
  await db.delete(schema.cockpitDecisions);
  await db.delete(schema.cockpitEvents);
  await db.delete(schema.cockpitSessions);
  // Wipe agent-attached autonomy policies (preserve named presets — those
  // are seeded by the migration and represent shared templates).
  await db
    .delete(schema.cockpitAutonomyPolicies)
    .where(sql`cockpit_agent_id IS NOT NULL`);
  await db.delete(schema.cockpitAgents);
  await db.delete(schema.cockpitWorkspaces);
  await db.delete(schema.cockpitProjects);

  // Projects.
  for (const p of projects) {
    await db.insert(schema.cockpitProjects).values(p as typeof schema.cockpitProjects.$inferInsert);
  }
  console.log(`Inserted ${projects.length} projects.`);

  // For each session: create workspace + agent + session + events + decisions.
  let eventCounter = 0;
  let totalDecisions = 0;
  let totalEvents = 0;

  for (const s of sessions) {
    const wsId = WS(s.ix);
    const agId = A(s.ix);
    const seId = S(s.ix);

    await db.insert(schema.cockpitWorkspaces).values({
      cockpitWorkspaceId: wsId,
      cockpitProjectId: s.project,
      kind: 'worktree',
      worktreePath: `/Users/lukeatherton/.cockpit-worktrees/${s.project.slice(-5)}/${wsId}`,
      branch: `agent/${s.label.replace(/\s+/g, '-')}`,
      status: s.state === 'stopped' ? 'removed' : 'active',
      metadata: {},
      createdAt: ms(-s.startedSecondsAgo),
    });

    await db.insert(schema.cockpitAgents).values({
      cockpitAgentId: agId,
      cockpitProjectId: s.project,
      cockpitWorkspaceId: wsId,
      agentType: 'claude-code-local',
      label: s.label,
      capabilities: ['edit-code', 'run-tests', 'read-files'],
      metadata: {},
      createdAt: ms(-s.startedSecondsAgo),
    });

    // Auto-attach trusted-default policy rows to this agent. Mirrors what the
    // step-1c spawn flow will do; doing it here lets the seeded data exercise
    // the same gate logic without further plumbing.
    const presetRows = await db
      .select({
        capability: schema.cockpitAutonomyPolicies.capability,
        stage: schema.cockpitAutonomyPolicies.stage,
        level: schema.cockpitAutonomyPolicies.level,
      })
      .from(schema.cockpitAutonomyPolicies)
      .where(sql`preset_name = 'trusted-default'`);
    let policyCounter = 0;
    for (const p of presetRows) {
      policyCounter++;
      await db.insert(schema.cockpitAutonomyPolicies).values({
        cockpitAutonomyPolicyId: `ckap_seed_${String(s.ix).padStart(2, '0')}_${String(policyCounter).padStart(2, '0')}_______`,
        cockpitAgentId: agId,
        presetName: null,
        capability: p.capability,
        stage: p.stage,
        level: p.level,
        createdAt: ms(-s.startedSecondsAgo),
        updatedAt: ms(-s.startedSecondsAgo),
      });
    }

    // Stage is derived from state; mock S5 (orienting) → scoping,
    // S6 (ready-for-review) → verification, rest → implementation.
    const stage =
      s.state === 'orienting' || s.state === 'queued'
        ? 'scoping'
        : s.state === 'ready-for-review'
          ? 'verification'
          : 'implementation';

    await db.insert(schema.cockpitSessions).values({
      cockpitSessionId: seId,
      cockpitAgentId: agId,
      cockpitProjectId: s.project,
      state: s.state,
      stage,
      task: s.task,
      externalId: `pid_${1000 + s.ix}`,
      startedAt: ms(-s.startedSecondsAgo),
      endedAt: s.state === 'stopped' ? ms(-60 * 60 * 2) : null,
      lastEventAt: ms(-s.lastEventSecondsAgo),
      currentTodos: s.todos ?? null,
      cumulativeInputTokens: s.cumulativeInputTokens,
      cumulativeCostUsd: s.cumulativeCostUsd,
      contextWindow: s.contextWindow,
      metadata: { mockState: true, label: s.label },
      createdAt: ms(-s.startedSecondsAgo),
    });

    for (const ev of s.events ?? []) {
      eventCounter++;
      await db.insert(schema.cockpitEvents).values({
        cockpitEventId: E(eventCounter),
        cockpitSessionId: seId,
        cockpitAgentId: agId,
        type: ev.type,
        payload: ev.payload,
        timestamp: ms(-ev.tSecondsAgo),
      });
      totalEvents++;
    }

    for (const dec of s.decisions ?? []) {
      const decisionEventId = E(++eventCounter);
      // Decisions reference an event id; fabricate one mirror event to satisfy FK semantics.
      await db.insert(schema.cockpitEvents).values({
        cockpitEventId: decisionEventId,
        cockpitSessionId: seId,
        cockpitAgentId: agId,
        type: dec.triggerType === 'scope-ambiguity' ? 'notification' : 'tool.pre',
        payload: { mock: true, ...dec.payload },
        timestamp: ms(-dec.createdSecondsAgo),
      });
      totalEvents++;

      const expiresAt =
        dec.expiresInSeconds === null || dec.expiresInSeconds === undefined
          ? null
          : ms(dec.expiresInSeconds);

      await db.insert(schema.cockpitDecisions).values({
        cockpitDecisionId: D(dec.ix),
        cockpitSessionId: seId,
        cockpitAgentId: agId,
        cockpitEventId: decisionEventId,
        triggerType: dec.triggerType,
        severity: dec.severity,
        status: dec.status,
        question: dec.question,
        detail: dec.detail ?? null,
        evidenceLines: dec.evidenceLines ?? null,
        rejectOptions: dec.rejectOptions ?? null,
        toolName: dec.toolName ?? null,
        command: dec.command ?? null,
        filePath: dec.filePath ?? null,
        payload: dec.payload ?? null,
        defaultChoice: dec.defaultChoice ?? null,
        defaultReply: dec.defaultReply ?? null,
        expiresAt,
        mode: 'pause-on-decision',
        createdAt: ms(-dec.createdSecondsAgo),
        resolvedAt: dec.resolvedSecondsAgo !== undefined ? ms(-dec.resolvedSecondsAgo) : null,
        resolvedBy: dec.resolvedSecondsAgo !== undefined ? 'me' : null,
      });
      totalDecisions++;

      // For closed decisions, also write a ledger entry.
      if (dec.status !== 'open') {
        await db.insert(schema.cockpitDecisionLedger).values({
          cockpitLedgerId: `ckle_seed_${String(dec.ix).padStart(2, '0')}_____________`,
          cockpitDecisionId: D(dec.ix),
          cockpitSessionId: seId,
          cockpitAgentId: agId,
          triggerType: dec.triggerType,
          question: dec.question,
          choice: dec.status,
          reason: 'mock-seed',
          refs: {},
          decidedAt: ms(-(dec.resolvedSecondsAgo ?? 0)),
          decidedBy: 'me',
        });
      }
    }

    console.log(
      `  S${String(s.ix).padStart(2, '0')} ${s.project.slice(-5)} state=${s.state.padEnd(16)} decisions=${s.decisions?.length ?? 0}`,
    );
  }

  console.log(`Inserted ${sessions.length} sessions, ${totalEvents} events, ${totalDecisions} decisions.`);
  await closeCockpitDb();
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
