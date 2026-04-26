ALTER TABLE "cockpit_sessions" ADD COLUMN "cumulative_cost_usd" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cockpit_sessions" ADD COLUMN "cumulative_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cockpit_sessions" ADD COLUMN "context_window" integer DEFAULT 200000 NOT NULL;