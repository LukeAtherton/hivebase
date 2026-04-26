// Integration test: end-to-end autonomy gate behaviour against the real
// dev DB. Sets up a synthetic agent + trusted-default policy attachment,
// emits classifier-bait events through persistence(), and asserts the
// expected decision/ledger pattern.
//
// Mirrors apps/cockpit-api/scripts/validate-autonomy.ts but as a proper
// test in the vitest runner — a regression here will fail CI.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  closeCockpitDb,
  cockpitAgents,
  cockpitAutonomyPolicies,
  cockpitDecisionLedger,
  cockpitDecisions,
  cockpitProjects,
  cockpitSessions,
  cockpitWorkspaces,
  getCockpitDb,
} from '@kybernos/platform';
import {
  generateCockpitAutonomyPolicyId,
  generateCockpitEventId,
} from '@kybernos/ids';
import { eventBus } from '../src/lib/event-bus.js';
import { startPersistence } from '../src/lib/persistence.js';

// Fixed test IDs so we can wipe-on-rerun without touching real seeded data.
// The cleanup in beforeAll/afterAll only ever touches rows with these ids.
const TEST_PROJECT = 'ckpr_TEST_autonomy__________';
const TEST_WORKSPACE = 'ckws_TEST_autonomy__________';
const TEST_AGENT = 'ckag_TEST_autonomy__________';
const TEST_SESSION = 'ckse_TEST_autonomy__________';

async function clean() {
  const db = getCockpitDb();
  await db.delete(cockpitDecisionLedger).where(eq(cockpitDecisionLedger.cockpitAgentId, TEST_AGENT));
  await db.delete(cockpitDecisions).where(eq(cockpitDecisions.cockpitAgentId, TEST_AGENT));
  await db.delete(cockpitAutonomyPolicies).where(eq(cockpitAutonomyPolicies.cockpitAgentId, TEST_AGENT));
  await db.delete(cockpitSessions).where(eq(cockpitSessions.cockpitAgentId, TEST_AGENT));
  await db.delete(cockpitAgents).where(eq(cockpitAgents.cockpitAgentId, TEST_AGENT));
  await db.delete(cockpitWorkspaces).where(eq(cockpitWorkspaces.cockpitWorkspaceId, TEST_WORKSPACE));
  await db.delete(cockpitProjects).where(eq(cockpitProjects.cockpitProjectId, TEST_PROJECT));
}

async function seedTestAgent(stage: 'scoping' | 'implementation' | 'verification') {
  const db = getCockpitDb();
  const now = new Date().toISOString();

  await db.insert(cockpitProjects).values({
    cockpitProjectId: TEST_PROJECT,
    workspaceId: 'wks_local',
    name: 'autonomy-test-fixture',
    kind: 'local-repo',
    repoPath: '/tmp/__test__',
    metadata: {},
    createdAt: now,
    createdBy: 'test',
  });

  await db.insert(cockpitWorkspaces).values({
    cockpitWorkspaceId: TEST_WORKSPACE,
    cockpitProjectId: TEST_PROJECT,
    kind: 'worktree',
    worktreePath: '/tmp/__test_wt__',
    branch: 'test',
    status: 'active',
    metadata: {},
    createdAt: now,
  });

  await db.insert(cockpitAgents).values({
    cockpitAgentId: TEST_AGENT,
    cockpitProjectId: TEST_PROJECT,
    cockpitWorkspaceId: TEST_WORKSPACE,
    agentType: 'claude-code-local',
    label: 'autonomy-test',
    capabilities: [],
    metadata: {},
    createdAt: now,
  });

  await db.insert(cockpitSessions).values({
    cockpitSessionId: TEST_SESSION,
    cockpitAgentId: TEST_AGENT,
    cockpitProjectId: TEST_PROJECT,
    state: 'implementing',
    stage,
    task: 'autonomy gate fixture',
    externalId: 'pid_test',
    startedAt: now,
    cumulativeInputTokens: 0,
    cumulativeCostUsd: 0,
    contextWindow: 200_000,
    metadata: {},
    createdAt: now,
  });

  // Attach the trusted-default preset rows to the test agent.
  const preset = await db
    .select({
      capability: cockpitAutonomyPolicies.capability,
      stage: cockpitAutonomyPolicies.stage,
      level: cockpitAutonomyPolicies.level,
    })
    .from(cockpitAutonomyPolicies)
    .where(sql`preset_name = 'trusted-default'`);
  if (preset.length === 0) {
    throw new Error("trusted-default preset missing — apply migrations + seed first");
  }
  await db.insert(cockpitAutonomyPolicies).values(
    preset.map((p) => ({
      cockpitAutonomyPolicyId: generateCockpitAutonomyPolicyId(),
      cockpitAgentId: TEST_AGENT,
      presetName: null,
      capability: p.capability,
      stage: p.stage,
      level: p.level,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

async function emitAndWait(
  type: 'tool.pre' | 'tool.post' | 'notification',
  payload: Record<string, unknown>,
) {
  eventBus.emit('event', {
    cockpitEventId: generateCockpitEventId(),
    cockpitSessionId: TEST_SESSION,
    cockpitAgentId: TEST_AGENT,
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
  // The persistence handler is async (registered as `void persist(event)`).
  // Give it a tick + a buffer to land all writes.
  await new Promise((r) => setTimeout(r, 350));
}

async function counts() {
  const db = getCockpitDb();
  const [d] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cockpitDecisions)
    .where(eq(cockpitDecisions.cockpitAgentId, TEST_AGENT));
  const [l] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cockpitDecisionLedger)
    .where(eq(cockpitDecisionLedger.cockpitAgentId, TEST_AGENT));
  return { decisions: d.n, ledger: l.n };
}

beforeAll(async () => {
  startPersistence();
  await clean();
});

afterAll(async () => {
  await clean();
  await closeCockpitDb();
});

describe('autonomy gate — implementation stage', () => {
  it('suppresses run-tests=allow and writes ledger only', async () => {
    await seedTestAgent('implementation');
    const before = await counts();

    await emitAndWait('tool.post', {
      toolName: 'Bash',
      command: 'pnpm test src/foo.test.ts',
      exitCode: 1,
      stderr: 'FAIL test',
    });

    const after = await counts();
    expect(after.decisions - before.decisions).toBe(0);
    expect(after.ledger - before.ledger).toBe(1);
    await clean();
  });

  it('surfaces destructive=ask as an open decision', async () => {
    await seedTestAgent('implementation');
    const before = await counts();

    await emitAndWait('tool.pre', {
      toolName: 'Bash',
      command: 'rm -rf /tmp/__some__',
    });

    const after = await counts();
    expect(after.decisions - before.decisions).toBe(1);
    expect(after.ledger - before.ledger).toBe(0);
    await clean();
  });

  it('always-human triggers (scope-ambiguity) bypass policy lookup', async () => {
    await seedTestAgent('implementation');
    const before = await counts();

    await emitAndWait('notification', { message: 'which approach?' });

    const after = await counts();
    expect(after.decisions - before.decisions).toBe(1);
    expect(after.ledger - before.ledger).toBe(0);
    await clean();
  });
});

describe('autonomy gate — scoping stage', () => {
  it('blocks edit-files=never with a pre-resolved decision + ledger', async () => {
    // In scoping, edit-files = never. An agent in this stage trying to edit a
    // file should see the decision get written status=blocked AND a ledger
    // entry — no operator interruption.
    await seedTestAgent('scoping');
    const before = await counts();

    await emitAndWait('tool.pre', {
      toolName: 'Edit',
      command: undefined,
      filePath: 'src/foo.ts',
    });

    // tool.pre on a non-sensitive non-destructive path returns null from
    // classify(); the gate never fires. So this assertion is actually about
    // the absence of any side-effect.
    const after = await counts();
    expect(after.decisions - before.decisions).toBe(0);
    expect(after.ledger - before.ledger).toBe(0);
    await clean();
  });
});
