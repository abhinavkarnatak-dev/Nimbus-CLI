import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { schema } from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbOptions {
  url: string;
  // Supabase CA certificate (PEM), turns on certificate checks
  caCert?: string;
}

// TLS settings: verify with the CA when we have it, else encrypt only
export function sslFor(options: DbOptions): pg.PoolConfig["ssl"] {
  const host = new URL(options.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return false;
  if (options.caCert) return { ca: options.caCert, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

// Small pool, the Supabase pooler limits clients
export function connectDb(options: DbOptions): { db: Db; close: () => Promise<void> } {
  const url = new URL(options.url);
  // We set TLS ourselves, sslmode in the URL would override it
  url.searchParams.delete("sslmode");
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslFor(options),
  });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
