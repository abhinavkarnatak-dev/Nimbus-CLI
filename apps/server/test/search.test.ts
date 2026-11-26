import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import { SEARCH_COST_MICRO_USD, SEARCH_MODEL } from "../src/db/ledger.js";
import { usageEvents, users } from "../src/db/schema.js";
import { issueToken } from "../src/db/tokens.js";
import { silentLogger } from "../src/log.js";
import { testDb } from "./db.js";
import { fakeGoogle } from "./fake-google.js";

const base = {
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

interface FakeTavily {
  status?: number;
  results?: unknown[];
}

async function setup(config: Partial<AppDeps["config"]> = {}, tavily: FakeTavily = {}) {
  const { token, userId } = await issueToken(db, `search${++count}@test.dev`, "test");
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchSearch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (tavily.status && tavily.status !== 200) {
      return new Response('{"detail":{"error":"nope"}}', { status: tavily.status });
    }
    return Response.json({
      results: tavily.results ?? [
        {
          title: "Race report",
          url: "https://example.com/race",
          content: "x".repeat(2000),
          published_date: "2026-11-23",
        },
        { title: "", url: "https://example.com/plain", content: "Short" },
        { title: "No url", content: "dropped" },
      ],
    });
  }) as typeof fetch;
  const app = createApp({
    config: { ...base, tavilyApiKey: "tvly-secret", ...config },
    db,
    google: fakeGoogle().google,
    fetchSearch,
    log: silentLogger,
  });
  const search = (body: unknown) =>
    app.request("/v1/search", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const rows = () => db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
  return { search, calls, rows, userId };
}

describe("web search", () => {
  it("asks Tavily for a basic search and returns short results", async () => {
    const { search, calls } = await setup();
    const res = await search({
      query: "who won the race",
      topic: "news",
      recency: "week",
      maxResults: 3,
    });
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://api.tavily.com/search");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer tvly-secret");
    expect(calls[0]!.body).toMatchObject({
      query: "who won the race",
      topic: "news",
      search_depth: "basic",
      max_results: 3,
      time_range: "week",
      include_answer: false,
    });
    const { results } = (await res.json()) as {
      results: { title: string; url: string; content: string; publishedDate?: string }[];
    };
    expect(results).toHaveLength(2);
    expect(results[0]!.content.length).toBeLessThanOrEqual(1203);
    expect(results[0]!.publishedDate).toBe("2026-11-23");
    expect(results[1]!.title).toBe("https://example.com/plain");
  });

  it("bills each search to the user's ledger and quota", async () => {
    const { search, rows, userId } = await setup();
    await search({ query: "hono body limit" });
    const [row] = await rows();
    expect(row).toMatchObject({ model: SEARCH_MODEL, costMicroUsd: SEARCH_COST_MICRO_USD });
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.spentMicroUsd).toBe(SEARCH_COST_MICRO_USD);
  });

  it("stops at the user's quota before searching", async () => {
    const { search, calls, userId } = await setup({ trialQuotaMicroUsd: 1 });
    await db.update(users).set({ spentMicroUsd: 1 }).where(eq(users.id, userId));
    expect((await search({ query: "anything" })).status).toBe(402);
    expect(calls).toHaveLength(0);
  });

  it("stops at the monthly search limit", async () => {
    const { search, calls } = await setup({ searchMonthlyLimit: 0 });
    const res = await search({ query: "anything" });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("limit reached for this month");
    expect(calls).toHaveLength(0);
  });

  it("maps Tavily errors and hides key problems", async () => {
    const keyProblem = await setup({}, { status: 401 });
    expect((await keyProblem.search({ query: "x y" })).status).toBe(502);
    const outOfCredits = await setup({}, { status: 432 });
    expect((await outOfCredits.search({ query: "x y" })).status).toBe(503);
    const failed = await setup({}, { status: 500 });
    const res = await failed.search({ query: "x y" });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("tvly");
    expect(await failed.rows()).toHaveLength(0);
  });

  it("refuses bad requests and works only when configured", async () => {
    const { search } = await setup();
    expect((await search({ query: "x" })).status).toBe(400);
    expect((await search({ query: "ok query", maxResults: 50 })).status).toBe(400);

    const unconfigured = await setup({ tavilyApiKey: undefined });
    expect((await unconfigured.search({ query: "anything" })).status).toBe(503);
  });
});
