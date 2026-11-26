CREATE TABLE "nimbus"."invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"max_uses" integer NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nimbus"."invites" (
	"email" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"code" text,
	"quota_micro_usd" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nimbus"."login_attempts" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "nimbus"."usage_events" ADD COLUMN "prompt_cache_key" text;--> statement-breakpoint
ALTER TABLE "nimbus"."users" ADD COLUMN "quota_micro_usd" bigint;--> statement-breakpoint
ALTER TABLE "nimbus"."users" ADD COLUMN "spent_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_events_cache_key_idx" ON "nimbus"."usage_events" USING btree ("user_id","prompt_cache_key");--> statement-breakpoint
-- Backfill running totals from the existing ledger
UPDATE "nimbus"."users" AS u SET "spent_micro_usd" = COALESCE((SELECT SUM(e."cost_micro_usd") FROM "nimbus"."usage_events" AS e WHERE e."user_id" = u."id"), 0);
