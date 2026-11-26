import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { inviteCodes, invites } from "./schema.js";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const normalizeCode = (code: string) => code.trim().toUpperCase();

export async function addInvite(db: Db, email: string, quotaMicroUsd?: number): Promise<void> {
  await db
    .insert(invites)
    .values({ email: normalizeEmail(email), source: "admin", quotaMicroUsd: quotaMicroUsd ?? null })
    .onConflictDoUpdate({
      target: invites.email,
      set: { quotaMicroUsd: quotaMicroUsd ?? null },
    });
}

export async function createInviteCode(
  db: Db,
  code: string,
  maxUses: number,
  expiresAt?: Date,
): Promise<void> {
  await db
    .insert(inviteCodes)
    .values({ code: normalizeCode(code), maxUses, expiresAt: expiresAt ?? null });
}

// Spend one use of a code, atomically, or return false
export async function useInviteCode(db: Db, code: string): Promise<boolean> {
  const rows = await db
    .update(inviteCodes)
    .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
    .where(
      and(
        eq(inviteCodes.code, normalizeCode(code)),
        lt(inviteCodes.usedCount, inviteCodes.maxUses),
        or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, sql`now()`)),
      ),
    )
    .returning({ code: inviteCodes.code });
  return rows.length > 0;
}

export async function findInvite(db: Db, email: string) {
  const [row] = await db
    .select()
    .from(invites)
    .where(eq(invites.email, normalizeEmail(email)));
  return row ?? null;
}
