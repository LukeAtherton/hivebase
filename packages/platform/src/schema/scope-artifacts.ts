import { pgTable, text, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Scope artifact (Sheridan + agent-handoff-decision.md).
//
// Created in 'draft' state on /scope/start, edited collaboratively
// during scoping (operator edits + agent suggestions),
// transitions to 'agreed' on operator approval.
//
// On agree the scoping agent is killed and a fresh implementation agent
// is spawned with the artifact rendered as initial user message — this
// row IS the entire context the implementation agent will have.
//
// 'superseded' is set when scope-expansion-during-impl creates a new
// artifact that replaces this one (deferred to step 4).
export const cockpitScopeArtifacts = pgTable(
  'cockpit_scope_artifacts',
  {
    cockpitScopeArtifactId: text('cockpit_scope_artifact_id').primaryKey(),
    cockpitSessionId: text('cockpit_session_id').notNull(),
    cockpitProjectId: text('cockpit_project_id').notNull(),
    status: text('status').notNull().default('draft'), // ScopeArtifactStatus

    // The agreed scope. All fields editable in 'draft', frozen in 'agreed'.
    task: text('task').notNull().default(''),
    acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().notNull().default([]),
    nonGoals: jsonb('non_goals').$type<string[]>().notNull().default([]),
    touchSurface: jsonb('touch_surface').$type<string[]>().notNull().default([]),

    // Autonomy preset name applied to the implementation agent on agree.
    // Default 'trusted-default'; operator may pick stricter / looser presets
    // before agreeing.
    autonomyPreset: text('autonomy_preset').notNull().default('trusted-default'),

    // Set when an artifact is replaced by a scope-expansion follow-up.
    supersededBy: text('superseded_by'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    agreedAt: text('agreed_at'),
  },
  (table) => ({
    sessionIdx: index('cockpit_scope_artifacts_session_idx').on(table.cockpitSessionId),
    projectIdx: index('cockpit_scope_artifacts_project_idx').on(table.cockpitProjectId),
    statusCheck: check(
      'cockpit_scope_artifacts_status_check',
      sql`${table.status} IN ('draft', 'agreed', 'superseded')`,
    ),
  }),
);
