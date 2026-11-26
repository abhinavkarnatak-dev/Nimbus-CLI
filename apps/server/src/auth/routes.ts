import { randomBytes } from "node:crypto";
import { generateCodeVerifier, generateState } from "arctic";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { authorizeAttempt, createAttempt, findPendingAttempt, redeemCode } from "../db/logins.js";
import { users } from "../db/schema.js";
import { createToken } from "../db/tokens.js";
import { upsertGoogleUser } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { apiError } from "../errors.js";
import type { Logger } from "../log.js";
import type { GoogleAuth } from "./google.js";
import { messagePage } from "./page.js";
import { isBase64Url, s256 } from "./pkce.js";

export interface AuthDeps {
  db: Db;
  google: GoogleAuth;
  log: Logger;
}

const exchangeSchema = z.object({
  code: z.string().min(16).max(200),
  verifier: z.string().min(43).max(128),
  label: z.string().max(100).optional(),
});

const invalidLink = messagePage(
  "Login link not valid",
  "This login link is broken or expired. Run nimbus login again.",
);

// Browser login for the CLI: start, Google callback, code exchange
export function authRoutes(deps: AuthDeps) {
  const { db, google, log } = deps;
  const app = new Hono<AppEnv>();

  app.get("/cli/start", async (c) => {
    const port = Number(c.req.query("port"));
    const state = c.req.query("state") ?? "";
    const challenge = c.req.query("challenge") ?? "";
    const valid =
      Number.isInteger(port) &&
      port >= 1024 &&
      port <= 65535 &&
      isBase64Url(state, 16, 128) &&
      isBase64Url(challenge, 43, 43);
    if (!valid) return c.html(invalidLink, 400);

    const googleState = generateState();
    const googleVerifier = generateCodeVerifier();
    await createAttempt(db, {
      cliState: state,
      cliChallenge: challenge,
      cliPort: port,
      googleState,
      googleVerifier,
    });
    return c.redirect(google.authorizationUrl(googleState, googleVerifier).toString(), 302);
  });

  app.get("/google/callback", async (c) => {
    const attempt = await findPendingAttempt(db, c.req.query("state") ?? "");
    if (!attempt) return c.html(invalidLink, 400);

    // Send the browser back to the CLI, never with a token in the URL
    const backToCli = (params: Record<string, string>) => {
      const url = new URL(`http://127.0.0.1:${attempt.cliPort}/callback`);
      url.searchParams.set("state", attempt.cliState);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return c.redirect(url.toString(), 302);
    };

    const code = c.req.query("code");
    if (!code) return backToCli({ error: c.req.query("error") ?? "access_denied" });

    let profile;
    try {
      profile = await google.profileFromCode(code, attempt.googleVerifier);
    } catch (error) {
      log("warn", "google code exchange failed", { error: (error as Error).message });
      return backToCli({ error: "google_failed" });
    }
    if (!profile.emailVerified) return backToCli({ error: "email_not_verified" });

    const user = await upsertGoogleUser(db, profile);
    if (user.status !== "active") return backToCli({ error: "account_blocked" });

    const oneTimeCode = randomBytes(32).toString("base64url");
    await authorizeAttempt(db, attempt.id, user.id, oneTimeCode);
    log("info", "login authorized", { user: user.id });
    return backToCli({ code: oneTimeCode });
  });

  app.post("/cli/exchange", async (c) => {
    const parsed = exchangeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError(c, 400, "Invalid login exchange request.", "invalid_request_error");
    }
    // The code is spent even if the verifier is wrong, so it cannot be guessed at
    const row = await redeemCode(db, parsed.data.code);
    if (!row?.userId || s256(parsed.data.verifier) !== row.cliChallenge) {
      return apiError(
        c,
        400,
        "Login code is invalid or expired. Run nimbus login again.",
        "invalid_request_error",
      );
    }
    const token = await createToken(db, row.userId, parsed.data.label ?? "cli");
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, row.userId));
    log("info", "cli token issued", { user: row.userId });
    return c.json({ token, email: user!.email });
  });

  return app;
}
