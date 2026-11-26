import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { hashToken } from "./tokens.js";
import type { Db } from "./client.js";
import { loginAttempts } from "./schema.js";

export const LOGIN_TTL_MS = 10 * 60 * 1000;

export interface NewAttempt {
  cliState: string;
  cliChallenge: string;
  cliPort: number;
  googleState: string;
  googleVerifier: string;
  inviteCode: string | null;
}

export async function createAttempt(db: Db, attempt: NewAttempt): Promise<void> {
  // Old attempts are useless, clear them on the way
  await db.delete(loginAttempts).where(lt(loginAttempts.expiresAt, sql`now() - interval '1 day'`));
  await db
    .insert(loginAttempts)
    .values({ ...attempt, expiresAt: new Date(Date.now() + LOGIN_TTL_MS) });
}

// Pending attempt for a Google callback
export async function findPendingAttempt(db: Db, googleState: string) {
  const [row] = await db
    .select()
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.googleState, googleState),
        isNull(loginAttempts.authorizedAt),
        gt(loginAttempts.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

export async function authorizeAttempt(
  db: Db,
  id: string,
  userId: string,
  code: string,
): Promise<void> {
  await db
    .update(loginAttempts)
    .set({ userId, codeHash: hashToken(code), authorizedAt: sql`now()` })
    .where(eq(loginAttempts.id, id));
}

// Use a one-time code exactly once
export async function redeemCode(db: Db, code: string) {
  const [row] = await db
    .update(loginAttempts)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(loginAttempts.codeHash, hashToken(code)),
        isNotNull(loginAttempts.authorizedAt),
        isNull(loginAttempts.usedAt),
        gt(loginAttempts.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: loginAttempts.userId, cliChallenge: loginAttempts.cliChallenge });
  return row ?? null;
}
