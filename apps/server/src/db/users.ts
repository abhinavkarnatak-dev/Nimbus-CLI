import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { users } from "./schema.js";

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

// Find by Google id, then link by email, else create
export async function upsertGoogleUser(db: Db, profile: GoogleProfile): Promise<UserRow> {
  const email = profile.email.trim().toLowerCase();
  const columns = { id: users.id, email: users.email, status: users.status };

  const [bySub] = await db.select(columns).from(users).where(eq(users.googleSub, profile.sub));
  if (bySub) {
    const [updated] = await db
      .update(users)
      .set({ email, name: profile.name ?? null })
      .where(eq(users.id, bySub.id))
      .returning(columns);
    return updated!;
  }

  const [byEmail] = await db.select(columns).from(users).where(eq(users.email, email));
  if (byEmail) {
    const [linked] = await db
      .update(users)
      .set({ googleSub: profile.sub, name: profile.name ?? null })
      .where(eq(users.id, byEmail.id))
      .returning(columns);
    return linked!;
  }

  const [created] = await db
    .insert(users)
    .values({ email, googleSub: profile.sub, name: profile.name ?? null })
    .returning(columns);
  return created!;
}
