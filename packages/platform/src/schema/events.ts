import { pgTable, text, jsonb, integer, index } from 'drizzle-orm/pg-core';

// Every NormalisedEvent landed by an adapter. Source of truth for
// session detail / replay. Decisions reference back into here.
//
// `tool_name` and `exit_code` are typed columns extracted from the
// payload's most-queried fields (per docs/future-work-research.md §5).
// They keep the JSON blob honest as a generic envelope while making
// classifier and analytics queries cheap.
export const cockpitEvents = pgTable(
  'cockpit_events',
  {
    cockpitEventId: text('cockpit_event_id').primaryKey(),
    cockpitSessionId: text('cockpit_session_id').notNull(),
    cockpitAgentId: text('cockpit_agent_id').notNull(),
    type: text('type').notNull(), // NormalisedEventType
    // Typed extracts of payload fields the classifier and analytics paths
    // both want. Persistence layer writes both into payload AND these
    // columns; reads prefer the typed column when present.
    toolName: text('tool_name'),
    exitCode: integer('exit_code'),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
    timestamp: text('timestamp').notNull(),
  },
  (table) => ({
    sessionIdx: index('cockpit_events_session_idx').on(table.cockpitSessionId),
    sessionTimeIdx: index('cockpit_events_session_time_idx').on(
      table.cockpitSessionId,
      table.timestamp,
    ),
    toolIdx: index('cockpit_events_tool_idx').on(table.toolName),
  }),
);
