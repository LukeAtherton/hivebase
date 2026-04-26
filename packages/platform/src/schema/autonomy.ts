import { pgTable, text, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Per-capability autonomy policy (Sheridan principle).
//
// One row per (agent or preset) × capability × stage × level.
// Gate logic (apps/cockpit-api/src/lib/persistence.ts) consults this
// table BEFORE writing a cockpit_decisions row:
//   - level=allow → return verdict directly to hook (no decision created)
//   - level=ask   → current behaviour (decision row, queue, human)
//   - level=never → write pre-resolved blocked decision (no human prompt)
//
// Either cockpit_agent_id is set (per-agent policy) OR preset_name is set
// (named template). The 'trusted-default' preset is seeded on migration
// and copied onto every newly-spawned agent.
export const cockpitAutonomyPolicies = pgTable(
  'cockpit_autonomy_policies',
  {
    cockpitAutonomyPolicyId: text('cockpit_autonomy_policy_id').primaryKey(),
    cockpitAgentId: text('cockpit_agent_id'),
    presetName: text('preset_name'),
    capability: text('capability').notNull(), // AutonomyCapability
    stage: text('stage').notNull(), // AgentStage
    level: text('level').notNull(), // AutonomyLevel
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    agentIdx: index('cockpit_autonomy_agent_idx').on(table.cockpitAgentId),
    presetIdx: index('cockpit_autonomy_preset_idx').on(table.presetName),
    // Per-agent uniqueness: at most one policy row per (agent, capability, stage).
    agentCapStageUnique: uniqueIndex('cockpit_autonomy_agent_cap_stage_uniq')
      .on(table.cockpitAgentId, table.capability, table.stage)
      .where(sql`${table.cockpitAgentId} IS NOT NULL`),
    // Per-preset uniqueness similarly.
    presetCapStageUnique: uniqueIndex('cockpit_autonomy_preset_cap_stage_uniq')
      .on(table.presetName, table.capability, table.stage)
      .where(sql`${table.presetName} IS NOT NULL`),
    // Either agent_id or preset_name must be set (exactly one is the
    // expected pattern but XOR is harder to express; CHECK enforces
    // at least one).
    targetCheck: check(
      'cockpit_autonomy_target_check',
      sql`${table.cockpitAgentId} IS NOT NULL OR ${table.presetName} IS NOT NULL`,
    ),
  }),
);
