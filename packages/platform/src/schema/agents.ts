import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

// An agent instance: type + workspace it lives in. One agent can have many
// sessions over its lifetime (resume, retry).
export const cockpitAgents = pgTable(
  'cockpit_agents',
  {
    cockpitAgentId: text('cockpit_agent_id').primaryKey(),
    cockpitProjectId: text('cockpit_project_id').notNull(),
    cockpitWorkspaceId: text('cockpit_workspace_id').notNull(),
    agentType: text('agent_type').notNull(), // AgentType from cockpit-core
    label: text('label'), // human-readable, e.g. "auth refactor"
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    projectIdx: index('cockpit_agents_project_idx').on(table.cockpitProjectId),
    workspaceIdx: index('cockpit_agents_workspace_idx').on(table.cockpitWorkspaceId),
  }),
);
