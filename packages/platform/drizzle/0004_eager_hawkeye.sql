CREATE TABLE IF NOT EXISTS "cockpit_autonomy_policies" (
	"cockpit_autonomy_policy_id" text PRIMARY KEY NOT NULL,
	"cockpit_agent_id" text,
	"preset_name" text,
	"capability" text NOT NULL,
	"stage" text NOT NULL,
	"level" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "cockpit_autonomy_target_check" CHECK ("cockpit_agent_id" IS NOT NULL OR "preset_name" IS NOT NULL),
	CONSTRAINT "cockpit_autonomy_capability_check" CHECK ("capability" IN ('read-files','edit-files','run-tests','run-build','run-migrations','push-branch','open-pr','merge-pr','network-fetch','install-package','destructive','delete-files','spend-over-threshold')),
	CONSTRAINT "cockpit_autonomy_stage_check" CHECK ("stage" IN ('scoping','implementation','verification')),
	CONSTRAINT "cockpit_autonomy_level_check" CHECK ("level" IN ('allow','ask','never'))
);
--> statement-breakpoint
ALTER TABLE "cockpit_sessions" ADD COLUMN "stage" text DEFAULT 'implementation' NOT NULL;--> statement-breakpoint
ALTER TABLE "cockpit_sessions" ADD CONSTRAINT "cockpit_sessions_stage_check" CHECK ("stage" IN ('scoping','implementation','verification'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_autonomy_agent_idx" ON "cockpit_autonomy_policies" USING btree ("cockpit_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_autonomy_preset_idx" ON "cockpit_autonomy_policies" USING btree ("preset_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cockpit_autonomy_agent_cap_stage_uniq" ON "cockpit_autonomy_policies" USING btree ("cockpit_agent_id","capability","stage") WHERE "cockpit_autonomy_policies"."cockpit_agent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cockpit_autonomy_preset_cap_stage_uniq" ON "cockpit_autonomy_policies" USING btree ("preset_name","capability","stage") WHERE "cockpit_autonomy_policies"."preset_name" IS NOT NULL;--> statement-breakpoint
-- Backfill: existing sessions stage from current state. orienting → scoping; ready-for-review → verification; everything else → implementation.
UPDATE "cockpit_sessions" SET "stage" = 'scoping' WHERE "state" IN ('queued','orienting');--> statement-breakpoint
UPDATE "cockpit_sessions" SET "stage" = 'verification' WHERE "state" = 'ready-for-review';--> statement-breakpoint
-- Seed the trusted-default preset rows (matrix from docs/stage-bottleneck-matrix.md).
-- Generated using a single ULID prefix per row for traceability in dev.
INSERT INTO "cockpit_autonomy_policies" ("cockpit_autonomy_policy_id","preset_name","capability","stage","level","created_at","updated_at") VALUES
	('ckap_seed_default_rfsc______', 'trusted-default','read-files','scoping','allow', now()::text, now()::text),
	('ckap_seed_default_rfim______', 'trusted-default','read-files','implementation','allow', now()::text, now()::text),
	('ckap_seed_default_rfvr______', 'trusted-default','read-files','verification','allow', now()::text, now()::text),
	('ckap_seed_default_efsc______', 'trusted-default','edit-files','scoping','never', now()::text, now()::text),
	('ckap_seed_default_efim______', 'trusted-default','edit-files','implementation','allow', now()::text, now()::text),
	('ckap_seed_default_efvr______', 'trusted-default','edit-files','verification','never', now()::text, now()::text),
	('ckap_seed_default_rtsc______', 'trusted-default','run-tests','scoping','allow', now()::text, now()::text),
	('ckap_seed_default_rtim______', 'trusted-default','run-tests','implementation','allow', now()::text, now()::text),
	('ckap_seed_default_rtvr______', 'trusted-default','run-tests','verification','allow', now()::text, now()::text),
	('ckap_seed_default_rbsc______', 'trusted-default','run-build','scoping','allow', now()::text, now()::text),
	('ckap_seed_default_rbim______', 'trusted-default','run-build','implementation','allow', now()::text, now()::text),
	('ckap_seed_default_rbvr______', 'trusted-default','run-build','verification','allow', now()::text, now()::text),
	('ckap_seed_default_rmsc______', 'trusted-default','run-migrations','scoping','never', now()::text, now()::text),
	('ckap_seed_default_rmim______', 'trusted-default','run-migrations','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_rmvr______', 'trusted-default','run-migrations','verification','never', now()::text, now()::text),
	('ckap_seed_default_pbsc______', 'trusted-default','push-branch','scoping','never', now()::text, now()::text),
	('ckap_seed_default_pbim______', 'trusted-default','push-branch','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_pbvr______', 'trusted-default','push-branch','verification','ask', now()::text, now()::text),
	('ckap_seed_default_opsc______', 'trusted-default','open-pr','scoping','never', now()::text, now()::text),
	('ckap_seed_default_opim______', 'trusted-default','open-pr','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_opvr______', 'trusted-default','open-pr','verification','ask', now()::text, now()::text),
	('ckap_seed_default_mpsc______', 'trusted-default','merge-pr','scoping','never', now()::text, now()::text),
	('ckap_seed_default_mpim______', 'trusted-default','merge-pr','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_mpvr______', 'trusted-default','merge-pr','verification','never', now()::text, now()::text),
	('ckap_seed_default_nfsc______', 'trusted-default','network-fetch','scoping','ask', now()::text, now()::text),
	('ckap_seed_default_nfim______', 'trusted-default','network-fetch','implementation','allow', now()::text, now()::text),
	('ckap_seed_default_nfvr______', 'trusted-default','network-fetch','verification','allow', now()::text, now()::text),
	('ckap_seed_default_ipsc______', 'trusted-default','install-package','scoping','never', now()::text, now()::text),
	('ckap_seed_default_ipim______', 'trusted-default','install-package','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_ipvr______', 'trusted-default','install-package','verification','never', now()::text, now()::text),
	('ckap_seed_default_dssc______', 'trusted-default','destructive','scoping','never', now()::text, now()::text),
	('ckap_seed_default_dsim______', 'trusted-default','destructive','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_dsvr______', 'trusted-default','destructive','verification','never', now()::text, now()::text),
	('ckap_seed_default_dfsc______', 'trusted-default','delete-files','scoping','never', now()::text, now()::text),
	('ckap_seed_default_dfim______', 'trusted-default','delete-files','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_dfvr______', 'trusted-default','delete-files','verification','never', now()::text, now()::text),
	('ckap_seed_default_stsc______', 'trusted-default','spend-over-threshold','scoping','ask', now()::text, now()::text),
	('ckap_seed_default_stim______', 'trusted-default','spend-over-threshold','implementation','ask', now()::text, now()::text),
	('ckap_seed_default_stvr______', 'trusted-default','spend-over-threshold','verification','ask', now()::text, now()::text);
