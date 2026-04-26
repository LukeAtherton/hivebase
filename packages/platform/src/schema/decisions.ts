import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

// The aged decision queue. One row per outstanding "human, look at this".
// Closed decisions stay (status=approved/blocked/replied/expired) for queue
// history; the canonical immutable record is cockpit_decision_ledger.
export const cockpitDecisions = pgTable(
  'cockpit_decisions',
  {
    cockpitDecisionId: text('cockpit_decision_id').primaryKey(),
    cockpitSessionId: text('cockpit_session_id').notNull(),
    cockpitAgentId: text('cockpit_agent_id').notNull(),
    cockpitEventId: text('cockpit_event_id').notNull(), // event that produced this
    triggerType: text('trigger_type').notNull(), // TriggerType
    severity: text('severity').notNull(), // Severity
    status: text('status').notNull().default('open'), // DecisionStatus
    question: text('question').notNull(),
    toolName: text('tool_name'),
    command: text('command'),
    filePath: text('file_path'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    // Cooldown UX: classifier picks a default; UI ticks down `expiresAt`; on
    // expiry the persistence layer applies `defaultChoice` automatically.
    // `required` severity sets expiresAt = null (no auto-expire).
    defaultChoice: text('default_choice'), // 'approve' | 'block' | 'reply' | 'dismiss'
    defaultReply: text('default_reply'),
    expiresAt: text('expires_at'),
    mode: text('mode').notNull().default('pause-on-decision'), // 'pause-on-decision' | 'ride-through'
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by'), // user id
  },
  (table) => ({
    statusIdx: index('cockpit_decisions_status_idx').on(table.status),
    sessionIdx: index('cockpit_decisions_session_idx').on(table.cockpitSessionId),
    openCreatedIdx: index('cockpit_decisions_open_created_idx').on(table.status, table.createdAt),
  }),
);
