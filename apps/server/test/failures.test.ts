import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { issueToken } from "../src/db/tokens.js";
import { silentLogger } from "../src/log.js";
import type { CallReport } from "../src/proxy/route.js";
import { testDb } from "./db.js";
import { fakeGoogle } from "./fake-google.js";
import { fakeUpstream, SSE_EVENTS, sse } from "./fake-upstream.js";

const config = {
  openaiApiKey: "sk",
  openaiBaseUrl: "https://upstream.test/v1",
  maxOutputTokens: 100,
};
const body = JSON.stringify({ model: "gpt-6-luna", input: "hi", stream: true });

describe("database failures", () => {
  it("still streams the answer when the ledger write fails", async () => {
    const { db, client } = await testDb();
    const { token } = await issueToken(db, "a@test.dev", "test");
    await db.execute(sql`drop table nimbus.usage_events`);
    const recorded: { report: CallReport; error?: unknown }[] = [];
    const app = createApp({
      google: fakeGoogle().google,
      config,
      db,
      fetchUpstream: fakeUpstream().fetchUpstream,
      log: silentLogger,
      onRecorded: (report, error) => recorded.push({ report, error }),
    });
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SSE_EVENTS.map(sse).join(""));
    for (let i = 0; i < 100 && recorded.length === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(recorded[0]?.error).toBeDefined();
    await client.close();
  });

  it("answers 503, not 401, when the token lookup fails", async () => {
    const { db, client } = await testDb();
    const { token } = await issueToken(db, "b@test.dev", "test");
    await db.execute(sql`drop schema nimbus cascade`);
    const upstream = fakeUpstream();
    const app = createApp({
      config,
      db,
      google: fakeGoogle().google,
      fetchUpstream: upstream.fetchUpstream,
      log: silentLogger,
    });
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(503);
    expect(upstream.calls).toHaveLength(0);
    await client.close();
  });
});
