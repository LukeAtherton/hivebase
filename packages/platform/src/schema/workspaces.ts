import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

// A workspace is the place an agent does its work.
// Local: a git worktree (path + branch).
// Cloud: a hivescaler job container.
// Distinct from cockpit_projects (the repo) and cockpit_agents (the actor).
export const cockpitWorkspaces = pgTable(
  'cockpit_workspaces',
  {
    cockpitWorkspaceId: text('cockpit_workspace_id').primaryKey(),
    cockpitProjectId: text('cockpit_project_id').notNull(),
    kind: text('kind').notNull(), // 'worktree' | 'hivescaler-container'
    worktreePath: text('worktree_path'), // worktree only
    branch: text('branch'), // worktree only
    hivescalerJobId: text('hivescaler_job_id'), // container only
    status: text('status').notNull().default('active'), // active | cleaning | removed
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull(),
    removedAt: text('removed_at'),
  },
  (table) => ({
    projectIdx: index('cockpit_workspaces_project_idx').on(table.cockpitProjectId),
  }),
);
