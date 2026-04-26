import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

// Every NormalisedEvent landed by an adapter. Source of truth for
// session detail / replay. Decisions reference back into here.
export const cockpitEvents = pgTable(
  'cockpit_events',
  {
    cockpitEventId: text('cockpit_event_id').primaryKey(),
    cockpitSessionId: text('cockpit_session_id').notNull(),
    cockpitAgentId: text('cockpit_agent_id').notNull(),
    type: text('type').notNull(), // NormalisedEventType
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
    timestamp: text('timestamp').notNull(),
  },
  (table) => ({
    sessionIdx: index('cockpit_events_session_idx').on(table.cockpitSessionId),
    sessionTimeIdx: index('cockpit_events_session_time_idx').on(
      table.cockpitSessionId,
      table.timestamp,
    ),
  }),
);
