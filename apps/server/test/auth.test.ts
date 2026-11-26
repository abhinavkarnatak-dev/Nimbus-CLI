import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { s256 } from "../src/auth/pkce.js";
import type { Db } from "../src/db/client.js";
import { addInvite, createInviteCode } from "../src/db/invites.js";
import { inviteCodes, loginAttempts, users } from "../src/db/schema.js";
import { issueToken } from "../src/db/tokens.js";
import { silentLogger } from "../src/log.js";
import { testDb } from "./db.js";
import { fakeGoogle } from "./fake-google.js";
import { fakeUpstream } from "./fake-upstream.js";

const config = {
  openaiApiKey: "sk",
  openaiBaseUrl: "https://upstream.test/v1",
  maxOutputTokens: 100,
};

let db: Db;
let client: PGlite;
let count = 0;

beforeAll(async () => {
  ({ db, client } = await testDb());
});
afterAll(async () => {
  await client.close();
});

interface SetupOptions {
  invited?: boolean;
  code?: string;
}

async function setup(
  profile?: Parameters<typeof fakeGoogle>[0],
  { invited = true, code }: SetupOptions = {},
) {
  const n = ++count;
  const fake = fakeGoogle({ sub: `sub-${n}`, email: `person${n}@gmail.com`, ...profile });
  if (invited) await addInvite(db, fake.state.profile.email);
  const app = createApp({
    config,
    db,
    google: fake.google,
    fetchUpstream: fakeUpstream().fetchUpstream,
    log: silentLogger,
  });
  const verifier = randomBytes(32).toString("base64url");
  const cliState = randomBytes(16).toString("base64url");

  const codePart = code ? `&invite=${code}` : "";
  const start = (query?: string) =>
    app.request(
      `/auth/cli/start?${query ?? `port=50123&state=${cliState}&challenge=${s256(verifier)}${codePart}`}`,
    );

  // Run start and the Google callback, return where the browser lands
  const loginInBrowser = async () => {
    const started = await start();
    expect(started.status).toBe(302);
    const googleUrl = new URL(started.headers.get("location")!);
    const googleState = googleUrl.searchParams.get("state")!;
    const callback = await app.request(
      `/auth/google/callback?state=${googleState}&code=google-code`,
    );
    expect(callback.status).toBe(302);
    return { landing: new URL(callback.headers.get("location")!), googleState };
  };

  const exchange = (code: string, withVerifier = verifier) =>
    app.request("/auth/cli/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier: withVerifier, label: "cli test" }),
    });

  const me = (token: string) =>
    app.request("/v1/me", { headers: { authorization: `Bearer ${token}` } });

  return { app, fake, verifier, cliState, start, loginInBrowser, exchange, me };
}

describe("cli login", () => {
  it("logs in end to end without the token ever being in a URL", async () => {
    const { loginInBrowser, exchange, me, cliState } = await setup();
    const { landing } = await loginInBrowser();
    expect(landing.origin).toBe("http://127.0.0.1:50123");
    expect(landing.pathname).toBe("/callback");
    expect(landing.searchParams.get("state")).toBe(cliState);
    expect(landing.toString()).not.toContain("nmb_");

    const res = await exchange(landing.searchParams.get("code")!);
    expect(res.status).toBe(200);
    const { token, email } = (await res.json()) as { token: string; email: string };
    expect(token).toMatch(/^nmb_/);
    expect(email).toMatch(/^person\d+@gmail\.com$/);

    const whoami = await me(token);
    expect(await whoami.json()).toEqual({ email, spentMicroUsd: 0, quotaMicroUsd: 500_000 });
  });

  it("uses each one-time code only once", async () => {
    const { loginInBrowser, exchange } = await setup();
    const code = (await loginInBrowser()).landing.searchParams.get("code")!;
    expect((await exchange(code)).status).toBe(200);
    expect((await exchange(code)).status).toBe(400);
  });

  it("refuses a code without the matching verifier and burns it", async () => {
    const { loginInBrowser, exchange } = await setup();
    const code = (await loginInBrowser()).landing.searchParams.get("code")!;
    const wrong = randomBytes(32).toString("base64url");
    expect((await exchange(code, wrong)).status).toBe(400);
    expect((await exchange(code)).status).toBe(400);
  });

  it("sends errors back to the CLI instead of logging in", async () => {
    const unverified = await setup({ emailVerified: false });
    expect((await unverified.loginInBrowser()).landing.searchParams.get("error")).toBe(
      "email_not_verified",
    );

    const failing = await setup();
    failing.fake.state.fail = true;
    expect((await failing.loginInBrowser()).landing.searchParams.get("error")).toBe(
      "google_failed",
    );

    const denied = await setup();
    const started = await denied.start();
    const googleState = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const res = await denied.app.request(
      `/auth/google/callback?state=${googleState}&error=access_denied`,
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("refuses blocked users", async () => {
    const blocked = await setup({ email: "blocked@gmail.com" }, { invited: false });
    const { userId } = await issueToken(db, "blocked@gmail.com", "admin");
    await db.update(users).set({ status: "blocked" }).where(eq(users.id, userId));
    expect((await blocked.loginInBrowser()).landing.searchParams.get("error")).toBe(
      "account_blocked",
    );
  });

  it("links a Google login to an existing user with the same email", async () => {
    const { userId } = await issueToken(db, "Existing@Gmail.com", "admin");
    const { loginInBrowser } = await setup(
      { email: "existing@gmail.com", sub: "sub-existing" },
      { invited: false },
    );
    await loginInBrowser();
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row!.googleSub).toBe("sub-existing");
  });

  it("rejects bad start links, unknown states and expired attempts", async () => {
    const { start, app } = await setup();
    expect((await start("port=80&state=abc&challenge=x")).status).toBe(400);
    expect((await app.request("/auth/google/callback?state=nope&code=x")).status).toBe(400);

    const started = await start();
    const googleState = new URL(started.headers.get("location")!).searchParams.get("state")!;
    await db
      .update(loginAttempts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(loginAttempts.googleState, googleState));
    const res = await app.request(`/auth/google/callback?state=${googleState}&code=x`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Run nimbus login again");
  });

  it("logs out by revoking the token", async () => {
    const { loginInBrowser, exchange, me, app } = await setup();
    const code = (await loginInBrowser()).landing.searchParams.get("code")!;
    const { token } = (await (await exchange(code)).json()) as { token: string };
    const out = await app.request("/v1/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.status).toBe(204);
    expect((await me(token)).status).toBe(401);
  });
});

describe("invites", () => {
  it("refuses new people without an invite", async () => {
    const { loginInBrowser } = await setup(undefined, { invited: false });
    expect((await loginInBrowser()).landing.searchParams.get("error")).toBe("not_invited");
  });

  it("lets people in with an invite code until its uses run out", async () => {
    await createInviteCode(db, "launch2", 1);
    const first = await setup(undefined, { invited: false, code: "launch2" });
    const code = (await first.loginInBrowser()).landing.searchParams.get("code")!;
    expect((await first.exchange(code)).status).toBe(200);

    const second = await setup(undefined, { invited: false, code: "LAUNCH2" });
    expect((await second.loginInBrowser()).landing.searchParams.get("error")).toBe("invalid_code");
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, "LAUNCH2"));
    expect(row!.usedCount).toBe(1);
  });

  it("refuses expired codes", async () => {
    await createInviteCode(db, "OLD", 5, new Date(Date.now() - 1000));
    const { loginInBrowser } = await setup(undefined, { invited: false, code: "OLD" });
    expect((await loginInBrowser()).landing.searchParams.get("error")).toBe("invalid_code");
  });

  it("does not spend a code on someone who is already invited", async () => {
    await createInviteCode(db, "SPARE", 1);
    const { loginInBrowser } = await setup(undefined, { code: "SPARE" });
    await loginInBrowser();
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, "SPARE"));
    expect(row!.usedCount).toBe(0);
  });
});
