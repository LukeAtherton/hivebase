ALTER TABLE "cockpit_events" ADD COLUMN "tool_name" text;--> statement-breakpoint
ALTER TABLE "cockpit_events" ADD COLUMN "exit_code" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cockpit_events_tool_idx" ON "cockpit_events" USING btree ("tool_name");--> statement-breakpoint
-- Backfill typed columns from existing JSON payloads (idempotent).
UPDATE "cockpit_events" SET "tool_name" = "payload"->>'toolName' WHERE "tool_name" IS NULL AND "payload" ? 'toolName';--> statement-breakpoint
UPDATE "cockpit_events" SET "exit_code" = ("payload"->>'exitCode')::int WHERE "exit_code" IS NULL AND "payload" ? 'exitCode' AND "payload"->>'exitCode' ~ '^-?[0-9]+$';