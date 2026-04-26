import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

// Append-only audit trail. Every resolved decision writes a row.
// "The decision ledger is the only persistent history the cockpit owns."
// Per-decision: agent assumption, question, human choice, why, refs.
export const cockpitDecisionLedger = pgTable(
  'cockpit_decision_ledger',
  {
    cockpitLedgerId: text('cockpit_ledger_id').primaryKey(),
    cockpitDecisionId: text('cockpit_decision_id').notNull(),
    cockpitSessionId: text('cockpit_session_id').notNull(),
    cockpitAgentId: text('cockpit_agent_id').notNull(),
    triggerType: text('trigger_type').notNull(),
    question: text('question').notNull(),
    agentAssumption: text('agent_assumption'),
    choice: text('choice').notNull(), // 'approved' | 'blocked' | 'replied'
    reply: text('reply'), // freeform reply text if any
    reason: text('reason'), // why the human chose what they did
    refs: jsonb('refs').$type<Record<string, unknown>>(), // PR, commit, file, etc.
    decidedAt: text('decided_at').notNull(),
    decidedBy: text('decided_by').notNull(),
  },
  (table) => ({
    sessionIdx: index('cockpit_decision_ledger_session_idx').on(table.cockpitSessionId),
    decisionIdx: index('cockpit_decision_ledger_decision_idx').on(table.cockpitDecisionId),
    timeIdx: index('cockpit_decision_ledger_time_idx').on(table.decidedAt),
  }),
);
