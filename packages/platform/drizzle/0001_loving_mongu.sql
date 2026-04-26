ALTER TABLE "cockpit_decisions" ADD COLUMN "default_choice" text;--> statement-breakpoint
ALTER TABLE "cockpit_decisions" ADD COLUMN "default_reply" text;--> statement-breakpoint
ALTER TABLE "cockpit_decisions" ADD COLUMN "expires_at" text;--> statement-breakpoint
ALTER TABLE "cockpit_decisions" ADD COLUMN "mode" text DEFAULT 'pause-on-decision' NOT NULL;