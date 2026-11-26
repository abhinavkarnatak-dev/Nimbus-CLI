import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { findInvite, normalizeEmail, useInviteCode } from "./invites.js";
import { invites, users } from "./schema.js";

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface UserRow {
  id: string;
  email: string;
  status: "active" | "blocked";
}

export type ResolveResult =
  { ok: true; user: UserRow } | { ok: false; reason: "not_invited" | "invalid_code" };

const columns = { id: users.id, email: users.email, status: users.status };

// Existing users always pass; new ones need an invite or a valid code
export async function resolveGoogleUser(
  db: Db,
  profile: GoogleProfile,
  inviteCode: string | null,
): Promise<ResolveResult> {
  const email = normalizeEmail(profile.email);
  return db.transaction(async (tx) => {
    const [bySub] = await tx.select(columns).from(users).where(eq(users.googleSub, profile.sub));
    if (bySub) {
      const [updated] = await tx
        .update(users)
        .set({ email, name: profile.name ?? null })
        .where(eq(users.id, bySub.id))
        .returning(columns);
      return { ok: true, user: updated! };
    }

    const [byEmail] = await tx.select(columns).from(users).where(eq(users.email, email));
    if (byEmail) {
      const [linked] = await tx
        .update(users)
        .set({ googleSub: profile.sub, name: profile.name ?? null })
        .where(eq(users.id, byEmail.id))
        .returning(columns);
      return { ok: true, user: linked! };
    }

    let invite = await findInvite(tx, email);
    if (!invite && inviteCode) {
      if (!(await useInviteCode(tx, inviteCode))) return { ok: false, reason: "invalid_code" };
      const [created] = await tx
        .insert(invites)
        .values({ email, source: "code", code: inviteCode.trim().toUpperCase() })
        .returning();
      invite = created ?? null;
    }
    if (!invite) return { ok: false, reason: "not_invited" };

    const [created] = await tx
      .insert(users)
      .values({
        email,
        googleSub: profile.sub,
        name: profile.name ?? null,
        quotaMicroUsd: invite.quotaMicroUsd,
      })
      .returning(columns);
    return { ok: true, user: created! };
  });
}
