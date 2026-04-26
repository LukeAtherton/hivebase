import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

// A repo (or hivescaler project) the cockpit watches.
// Local projects are identified by absolute repoPath.
// Hivescaler projects link out via hivescalerProjectId.
export const cockpitProjects = pgTable(
  'cockpit_projects',
  {
    cockpitProjectId: text('cockpit_project_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(), // BetterAuth workspace
    name: text('name').notNull(),
    kind: text('kind').notNull(), // 'local-repo' | 'hivescaler'
    repoPath: text('repo_path'), // local-repo only
    hivescalerProjectId: text('hivescaler_project_id'), // hivescaler only
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (table) => ({
    workspaceIdx: index('cockpit_projects_workspace_idx').on(table.workspaceId),
  }),
);
