ALTER TABLE "cockpit_decisions" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "cockpit_decisions" ADD COLUMN "evidence_lines" jsonb;--> statement-breakpoint
ALTER TABLE "cockpit_decisions" ADD COLUMN "reject_options" jsonb;