import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import { usageEvents, users } from "../src/db/schema.js";
import { issueToken } from "../src/db/tokens.js";
import { UserLimits } from "../src/limits.js";
import { silentLogger } from "../src/log.js";
import type { CallReport } from "../src/proxy/route.js";
import { billableChars } from "../src/proxy/route.js";
import { testDb } from "./db.js";
import { fakeGoogle } from "./fake-google.js";
import { fakeUpstream, SSE_EVENTS, sse } from "./fake-upstream.js";

const base = {
  openaiApiKey: "sk",
  openaiBaseUrl: "https://upstream.test/v1",
  maxOutputTokens: 100,
};
const body = (key = "session-1", input = "hi") =>
  JSON.stringify({ model: "gpt-6-luna", input, stream: true, prompt_cache_key: key });

let db: Db;
let client: PGlite;
let count = 0;

beforeAll(async () => {
  ({ db, client } = await testDb());
});
afterAll(async () => {
  await client.close();
});

async function setup(
  config: Partial<AppDeps["config"]> = {},
  upstreamOptions?: Parameters<typeof fakeUpstream>[0],
) {
  const { token, userId } = await issueToken(db, `limits${++count}@test.dev`, "test");
  const upstream = fakeUpstream(upstreamOptions);
  const recorded: CallReport[] = [];
  const app = createApp({
    config: { ...base, ...config },
    db,
    google: fakeGoogle().google,
    fetchUpstream: upstream.fetchUpstream,
    log: silentLogger,
    onRecorded: (report) => recorded.push(report),
  });
  const post = (key?: string) =>
    app.request("/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body(key),
    });
  const user = async () => (await db.select().from(users).where(eq(users.id, userId)))[0]!;
  return { app, upstream, recorded, post, userId, user };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("quota", () => {
  it("keeps the running total equal to the ledger", async () => {
    const { post, recorded, user, userId } = await setup();
    await (await post()).text();
    await (await post()).text();
    await waitFor(() => recorded.length === 2);
    const rows = await db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
    const ledger = rows.reduce((sum, row) => sum + row.costMicroUsd, 0);
    expect((await user()).spentMicroUsd).toBe(ledger);
    expect(ledger).toBe(100);
  });

  it("stops a user at the trial quota without calling OpenAI", async () => {
    const { post, upstream, userId } = await setup({ trialQuotaMicroUsd: 1000 });
    await db.update(users).set({ spentMicroUsd: 1000 }).where(eq(users.id, userId));
    const res = await post();
    expect(res.status).toBe(402);
    expect(await res.text()).toContain("trial credit is used up ($0.00)");
    expect(upstream.calls).toHaveLength(0);
  });

  it("uses a per-user quota when one is set", async () => {
    const { post, userId } = await setup({ trialQuotaMicroUsd: 1000 });
    await db
      .update(users)
      .set({ spentMicroUsd: 5000, quotaMicroUsd: 1_000_000 })
      .where(eq(users.id, userId));
    expect((await post()).status).toBe(200);
  });

  it("reports spend and quota on /v1/me", async () => {
    const { app, userId } = await setup({ trialQuotaMicroUsd: 250_000 });
    await db.update(users).set({ spentMicroUsd: 1234 }).where(eq(users.id, userId));
    const { token } = await issueToken(
      db,
      (await db.select().from(users).where(eq(users.id, userId)))[0]!.email,
      "me",
    );
    const res = await app.request("/v1/me", { headers: { authorization: `Bearer ${token}` } });
    expect(await res.json()).toMatchObject({ spentMicroUsd: 1234, quotaMicroUsd: 250_000 });
  });
});

describe("kill switch", () => {
  it("pauses everyone when NIMBUS_PAUSED is on", async () => {
    const { post, upstream } = await setup({ paused: true });
    expect((await post()).status).toBe(503);
    expect(upstream.calls).toHaveLength(0);
  });

  it("pauses everyone once the global budget is reached", async () => {
    const { post, userId, upstream } = await setup({ globalBudgetMicroUsd: 10 });
    await db.update(users).set({ spentMicroUsd: 50 }).where(eq(users.id, userId));
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("usage limit");
    expect(upstream.calls).toHaveLength(0);
  });
});

describe("request limits", () => {
  it("allows only a few requests at once per user", async () => {
    const { post } = await setup(
      { maxConcurrent: 1 },
      { chunks: [sse(SSE_EVENTS[1])], hang: true },
    );
    const first = await post();
    expect(first.status).toBe(200);
    expect((await post()).status).toBe(429);
    await first.body!.cancel();
    expect((await post()).status).toBe(200);
  });

  it("limits requests per minute", async () => {
    const { post } = await setup({ ratePerMinute: 2 });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const third = await post();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("20");
  });

  it("opens a new window after a minute", () => {
    let now = 0;
    const limits = new UserLimits(5, 1, () => now);
    expect("release" in limits.acquire("u")).toBe(true);
    expect(limits.acquire("u")).toEqual({ refused: "rate" });
    now = 60_000;
    expect("release" in limits.acquire("u")).toBe(true);
  });
});

describe("cancel estimates", () => {
  it("leaves encrypted reasoning out of the billable size", () => {
    const blob = "x".repeat(10_000);
    const withReasoning = billableChars({
      model: "gpt-6-luna",
      stream: true,
      input: [
        { type: "reasoning", encrypted_content: blob },
        { role: "user", content: "hi" },
      ],
    });
    expect(withReasoning).toBeLessThan(200);
  });

  it("uses the cached share of the last call in the same session", async () => {
    const delta = { type: "response.output_text.delta", delta: "x".repeat(40) };
    const finished = await setup();
    await (await finished.post("same-session")).text();
    await waitFor(() => finished.recorded.length === 1);

    // Same user, a cancelled call in the same session
    const cancelling = createApp({
      config: base,
      db,
      google: fakeGoogle().google,
      fetchUpstream: fakeUpstream({ chunks: [sse(delta)], hang: true }).fetchUpstream,
      log: silentLogger,
      onRecorded: (report) => finished.recorded.push(report),
    });
    const { token } = await issueToken(db, (await finished.user()).email, "second");
    const res = await cancelling.request("/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body("same-session", "a long question ".repeat(250)),
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => finished.recorded.length === 2);

    const rows = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.userId, finished.userId))
      .orderBy(usageEvents.id);
    const estimate = rows[1]!;
    expect(estimate).toMatchObject({
      outcome: "cancelled",
      estimated: true,
      promptCacheKey: "same-session",
    });
    // The finished call was 1000 of 1200 cached, so about 83 percent here too
    expect(estimate.cachedTokens / estimate.inputTokens).toBeCloseTo(1000 / 1200, 1);
  });
});
