CREATE TABLE "nimbus"."login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cli_state" text NOT NULL,
	"cli_challenge" text NOT NULL,
	"cli_port" integer NOT NULL,
	"google_state" text NOT NULL,
	"google_verifier" text NOT NULL,
	"code_hash" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	CONSTRAINT "login_attempts_google_state_unique" UNIQUE("google_state"),
	CONSTRAINT "login_attempts_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "nimbus"."login_attempts" ADD CONSTRAINT "login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nimbus"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempts_expires_idx" ON "nimbus"."login_attempts" USING btree ("expires_at");