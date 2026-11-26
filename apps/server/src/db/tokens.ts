import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { apiTokens, users } from "./schema.js";

const TOKEN_PREFIX = "nmb_";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface TokenOwner {
  tokenId: string;
  userId: string;
  email: string;
  lastUsedAt: Date | null;
}

// Create the user if needed, store only the hash
export async function issueToken(
  db: Db,
  email: string,
  label: string,
): Promise<{ token: string; userId: string }> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db
    .insert(users)
    .values({ email: normalized })
    .onConflictDoUpdate({ target: users.email, set: { email: normalized } })
    .returning({ id: users.id });
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  await db.insert(apiTokens).values({ userId: user!.id, tokenHash: hashToken(token), label });
  return { token, userId: user!.id };
}

// Valid token of an active user, or null
export async function findTokenOwner(db: Db, token: string): Promise<TokenOwner | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      userId: users.id,
      email: users.email,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`)),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function touchToken(db: Db, tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiTokens.id, tokenId));
}

export async function revokeToken(db: Db, tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: sql`now()` })
    .where(eq(apiTokens.id, tokenId));
}
