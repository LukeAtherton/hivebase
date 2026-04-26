/**
 * Step 1e validation — autonomy gate logic.
 *
 * Synthesises three classifier hits against seeded agents and asserts the
 * gate logic produces the expected outcome:
 *
 *   1. failed-validation (pnpm test failed) on impl-stage agent S1 →
 *      run-tests=allow → SUPPRESSED (no decision row, ledger row written)
 *   2. destructive-action (rm -rf) on impl-stage agent S1 →
 *      destructive=ask → DECISION ROW WRITTEN (status=open)
 *   3. failed-validation (pnpm test failed) on scoping-stage agent S5 →
 *      run-tests=allow (also allow in scoping) → SUPPRESSED
 *
 * Run after `pnpm db:seed` while the cockpit-api process is running.
 *   pnpm --filter @kybernos/cockpit-api validate:autonomy
 */

import { eventBus } from '../src/lib/event-bus.js';
import { startPersistence } from '../src/lib/persistence.js';
import { getCockpitDb, cockpitDecisions, cockpitDecisionLedger } from '@kybernos/platform';
import { eq } from 'drizzle-orm';
import { generateCockpitEventId } from '@kybernos/ids';

async function main() {
  // Hook the persistence layer up to the event bus before emitting.
  startPersistence();

  const db = getCockpitDb();

  // Snapshot before / after counts to detect insertion side-effects.
  const beforeDecisions = await db.select({ id: cockpitDecisions.cockpitDecisionId }).from(cockpitDecisions);
  const beforeLedger = await db.select({ id: cockpitDecisionLedger.cockpitLedgerId }).from(cockpitDecisionLedger);

  console.log(`Baseline: ${beforeDecisions.length} decisions, ${beforeLedger.length} ledger rows.`);

  const cases: Array<{
    label: string;
    sessionId: string;
    agentId: string;
    eventType: 'tool.post' | 'tool.pre';
    payload: Record<string, unknown>;
  }> = [
    {
      label: 'failed-validation (pnpm test) on S1 implementation — should suppress',
      sessionId: 'ckse_seed_01_____________',
      agentId: 'ckag_seed_01_____________',
      eventType: 'tool.post',
      payload: {
        toolName: 'Bash',
        command: 'pnpm test src/routes/profile.test.ts',
        exitCode: 1,
        stderr: 'fail',
      },
    },
    {
      label: 'destructive-action (rm -rf) on S1 implementation — should still surface',
      sessionId: 'ckse_seed_01_____________',
      agentId: 'ckag_seed_01_____________',
      eventType: 'tool.pre',
      payload: {
        toolName: 'Bash',
        command: 'rm -rf packages/foo/dist',
      },
    },
    {
      label: 'failed-validation (pnpm test) on S5 scoping — should suppress',
      sessionId: 'ckse_seed_05_____________',
      agentId: 'ckag_seed_05_____________',
      eventType: 'tool.post',
      payload: {
        toolName: 'Bash',
        command: 'pnpm test',
        exitCode: 1,
      },
    },
  ];

  for (const c of cases) {
    eventBus.emit('event', {
      cockpitEventId: generateCockpitEventId(),
      cockpitSessionId: c.sessionId,
      cockpitAgentId: c.agentId,
      type: c.eventType,
      payload: c.payload,
      timestamp: new Date().toISOString(),
    });
  }

  // The persistence layer is async; give it a beat.
  await new Promise((r) => setTimeout(r, 1500));

  const afterDecisions = await db.select({ id: cockpitDecisions.cockpitDecisionId }).from(cockpitDecisions);
  const afterLedger = await db.select({ id: cockpitDecisionLedger.cockpitLedgerId }).from(cockpitDecisionLedger);

  const decisionDelta = afterDecisions.length - beforeDecisions.length;
  const ledgerDelta = afterLedger.length - beforeLedger.length;

  console.log(`After 3 events: +${decisionDelta} decisions, +${ledgerDelta} ledger rows.`);

  // Expected:
  //   case 1: ledger +1, decisions +0 (suppressed)
  //   case 2: decisions +1, ledger +0 (ask, surfaced)
  //   case 3: ledger +1, decisions +0 (suppressed)
  // Totals: decisions +1, ledger +2
  const expectedDecisions = 1;
  const expectedLedger = 2;

  let pass = true;
  if (decisionDelta !== expectedDecisions) {
    console.error(`  ❌ expected +${expectedDecisions} decision, got +${decisionDelta}`);
    pass = false;
  } else {
    console.log(`  ✅ decision delta correct (+${decisionDelta})`);
  }
  if (ledgerDelta !== expectedLedger) {
    console.error(`  ❌ expected +${expectedLedger} ledger rows, got +${ledgerDelta}`);
    pass = false;
  } else {
    console.log(`  ✅ ledger delta correct (+${ledgerDelta})`);
  }

  // Inspect the new ledger entries: should both be reason='autonomy-policy'.
  const newLedger = afterLedger.slice(beforeLedger.length);
  const newLedgerRows = await db
    .select({
      reason: cockpitDecisionLedger.reason,
      choice: cockpitDecisionLedger.choice,
      triggerType: cockpitDecisionLedger.triggerType,
    })
    .from(cockpitDecisionLedger)
    .where(eq(cockpitDecisionLedger.cockpitLedgerId, newLedger[0]?.id ?? '__none__'));
  console.log('  sample new ledger row:', newLedgerRows[0]);

  if (!pass) process.exit(1);
  console.log('\nAll assertions passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
