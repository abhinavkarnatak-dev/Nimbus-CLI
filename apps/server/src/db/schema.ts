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
  (table) => [index("usage_events_user_time_idx").on(table.userId, table.createdAt)],
);

export const schema = { users, apiTokens, usageEvents };
