import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Own schema, so Supabase's Data API never exposes it
export const nimbus = pgSchema("nimbus");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = nimbus.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  googleSub: text("google_sub").unique(),
  status: text("status", { enum: ["active", "blocked"] })
    .notNull()
    .default("active"),
  // Null means the default trial quota from the server config
  quotaMicroUsd: bigint("quota_micro_usd", { mode: "number" }),
  // Running total of the ledger, kept in the same transaction
  spentMicroUsd: bigint("spent_micro_usd", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
});

// Emails allowed to create an account
export const invites = nimbus.table("invites", {
  email: text("email").primaryKey(),
  source: text("source", { enum: ["admin", "code"] }).notNull(),
  code: text("code"),
  quotaMicroUsd: bigint("quota_micro_usd", { mode: "number" }),
  createdAt: createdAt(),
});

// Shareable codes with a limited number of uses
export const inviteCodes = nimbus.table("invite_codes", {
  code: text("code").primaryKey(),
  maxUses: integer("max_uses").notNull(),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const apiTokens = nimbus.table(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("api_tokens_user_idx").on(table.userId)],
);

export const USAGE_OUTCOMES = [
  "finished",
  "cancelled",
  "client_left",
  "no_final_event",
  "upstream_error",
] as const;

// Append-only ledger, one row per model call
export const usageEvents = nimbus.table(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    promptCacheKey: text("prompt_cache_key"),
    outcome: text("outcome", { enum: USAGE_OUTCOMES }).notNull(),
    responseStatus: text("response_status"),
    inputTokens: integer("input_tokens").notNull(),
    cachedTokens: integer("cached_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    estimated: boolean("estimated").notNull().default(false),
    durationMs: integer("duration_ms").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("usage_events_user_time_idx").on(table.userId, table.createdAt),
    index("usage_events_cache_key_idx").on(table.userId, table.promptCacheKey),
  ],
);

// One browser login started by the CLI, valid for a few minutes
export const loginAttempts = nimbus.table(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cliState: text("cli_state").notNull(),
    cliChallenge: text("cli_challenge").notNull(),
    cliPort: integer("cli_port").notNull(),
    googleState: text("google_state").notNull().unique(),
    googleVerifier: text("google_verifier").notNull(),
    inviteCode: text("invite_code"),
    codeHash: text("code_hash").unique(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [index("login_attempts_expires_idx").on(table.expiresAt)],
);

export const schema = { users, invites, inviteCodes, apiTokens, usageEvents, loginAttempts };
