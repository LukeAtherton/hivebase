CREATE TABLE IF NOT EXISTS "cockpit_agents" (
	"cockpit_agent_id" text PRIMARY KEY NOT NULL,
	"cockpit_project_id" text NOT NULL,
	"cockpit_workspace_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"label" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cockpit_decision_ledger" (
	"cockpit_ledger_id" text PRIMARY KEY NOT NULL,
	"cockpit_decision_id" text NOT NULL,
	"cockpit_session_id" text NOT NULL,
	"cockpit_agent_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"question" text NOT NULL,
	"agent_assumption" text,
	"choice" text NOT NULL,
	"reply" text,
	"reason" text,
	"refs" jsonb,
	"decided_at" text NOT NULL,
	"decided_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cockpit_decisions" (
	"cockpit_decision_id" text PRIMARY KEY NOT NULL,
	"cockpit_session_id" text NOT NULL,
	"cockpit_agent_id" text NOT NULL,
	"cockpit_event_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"question" text NOT NULL,
	"tool_name" text,
	"command" text,
	"file_path" text,
	"payload" jsonb,
	"created_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cockpit_events" (
	"cockpit_event_id" text PRIMARY KEY NOT NULL,
	"cockpit_session_id" text NOT NULL,
	"cockpit_agent_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cockpit_projects" (
	"cockpit_project_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"repo_path" text,
	"hivescaler_project_id" text,
	"metadata" jsonb,
	"created_at" text NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cockpit_sessions" (
	"cockpit_session_id" text PRIMARY KEY NOT NULL,
	"cockpit_agent_id" text NOT NULL,
	"cockpit_project_id" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"task" text NOT NULL,
	"external_id" text,
	"started_at" text,
	"ended_at" text,
	"last_event_at" text,
	"metadata" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cockpit_workspaces" (
	"cockpit_workspace_id" text PRIMARY KEY NOT NULL,
	"cockpit_project_id" text NOT NULL,
	"kind" text NOT NULL,
	"worktree_path" text,
	"branch" text,
	"hivescaler_job_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" text NOT NULL,
	"removed_at" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_agents_project_idx" ON "cockpit_agents" USING btree ("cockpit_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_agents_workspace_idx" ON "cockpit_agents" USING btree ("cockpit_workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_decision_ledger_session_idx" ON "cockpit_decision_ledger" USING btree ("cockpit_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_decision_ledger_decision_idx" ON "cockpit_decision_ledger" USING btree ("cockpit_decision_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_decision_ledger_time_idx" ON "cockpit_decision_ledger" USING btree ("decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_decisions_status_idx" ON "cockpit_decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_decisions_session_idx" ON "cockpit_decisions" USING btree ("cockpit_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_decisions_open_created_idx" ON "cockpit_decisions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_events_session_idx" ON "cockpit_events" USING btree ("cockpit_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_events_session_time_idx" ON "cockpit_events" USING btree ("cockpit_session_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_projects_workspace_idx" ON "cockpit_projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_sessions_agent_idx" ON "cockpit_sessions" USING btree ("cockpit_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_sessions_state_idx" ON "cockpit_sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_sessions_project_state_idx" ON "cockpit_sessions" USING btree ("cockpit_project_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_workspaces_project_idx" ON "cockpit_workspaces" USING btree ("cockpit_project_id");