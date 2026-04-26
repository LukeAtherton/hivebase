import { pgTable, text, jsonb, index, integer, real } from 'drizzle-orm/pg-core';
import type { PlanItem } from '@kybernos/core';

// One agent run. State machine drives the portfolio-map tile colour.
export const cockpitSessions = pgTable(
  'cockpit_sessions',
  {
    cockpitSessionId: text('cockpit_session_id').primaryKey(),
    cockpitAgentId: text('cockpit_agent_id').notNull(),
    cockpitProjectId: text('cockpit_project_id').notNull(),
    state: text('state').notNull().default('queued'), // SessionState
    // Conceptual stage: scoping | implementation | verification.
    // Distinct from `state` (which is finer-grained machine state).
    // Used by the autonomy policy lookup — different stages can have
    // different capability rules. See packages/core/src/types.ts
    // stageFromSessionState() for the canonical mapping when a session
    // doesn't yet have an explicit stage set.
    stage: text('stage').notNull().default('implementation'), // AgentStage
    task: text('task').notNull(), // the brief
    externalId: text('external_id'), // adapter-native: PID, jobId, etc.
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
    lastEventAt: text('last_event_at'),
    // Latest plan/todo list snapshot (TodoWrite for Claude Code agents).
    // Replaced wholesale on every plan.updated event.
    currentTodos: jsonb('current_todos').$type<PlanItem[]>(),
    // Cumulative token-equivalent value of work (for the LOAD readout) and
    // cumulative input-token count for context-pressure height on the map.
    // Updated on every cost.updated event.
    cumulativeCostUsd: real('cumulative_cost_usd').notNull().default(0),
    cumulativeInputTokens: integer('cumulative_input_tokens').notNull().default(0),
    // Model context window in tokens (e.g. 200_000 for Sonnet, 1_000_000 for
    // Opus 1M). Used to compute pressure = cumulativeInputTokens / contextWindow.
    contextWindow: integer('context_window').notNull().default(200000),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    agentIdx: index('cockpit_sessions_agent_idx').on(table.cockpitAgentId),
    stateIdx: index('cockpit_sessions_state_idx').on(table.state),
    projectStateIdx: index('cockpit_sessions_project_state_idx').on(
      table.cockpitProjectId,
      table.state,
    ),
  }),
);
