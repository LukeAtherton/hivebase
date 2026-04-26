CREATE TABLE IF NOT EXISTS "cockpit_scope_artifacts" (
	"cockpit_scope_artifact_id" text PRIMARY KEY NOT NULL,
	"cockpit_session_id" text NOT NULL,
	"cockpit_project_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"task" text DEFAULT '' NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"non_goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"touch_surface" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"autonomy_preset" text DEFAULT 'trusted-default' NOT NULL,
	"superseded_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"agreed_at" text,
	CONSTRAINT "cockpit_scope_artifacts_status_check" CHECK ("status" IN ('draft', 'agreed', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_scope_artifacts_session_idx" ON "cockpit_scope_artifacts" USING btree ("cockpit_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_scope_artifacts_project_idx" ON "cockpit_scope_artifacts" USING btree ("cockpit_project_id");