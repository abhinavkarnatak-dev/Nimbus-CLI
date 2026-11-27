import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, MAX_BODY_BYTES } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import { apiTokens, usageEvents, users } from "../src/db/schema.js";
import { issueToken } from "../src/db/tokens.js";
import { silentLogger } from "../src/log.js";
import type { CallReport } from "../src/proxy/route.js";
import { FinalEventScanner, relay } from "../src/proxy/usage.js";
import { testDb } from "./db.js";
import { fakeGoogle } from "./fake-google.js";
import { fakeUpstream, SSE_EVENTS, sse } from "./fake-upstream.js";

const config = {
  openaiApiKey: "sk-server-secret",
  openaiBaseUrl: "https://upstream.test/v1",
  maxOutputTokens: 16_000,
};

const validBody = {
  model: "gpt-6-luna",
  input: [{ role: "user", content: "hi" }],
  instructions: "Be brief.",
  store: false,
  stream: true,
};

let db: Db;
let client: PGlite;
let userCount = 0;

beforeAll(async () => {
  ({ db, client } = await testDb());
});
afterAll(async () => {
  await client.close();
});

async function setup(upstreamOptions?: Parameters<typeof fakeUpstream>[0]) {
  const { token, userId } = await issueToken(db, `user${++userCount}@test.dev`, "test");
  const upstream = fakeUpstream(upstreamOptions);
  const recorded: { report: CallReport; error?: unknown }[] = [];
  const app = createApp({
    google: fakeGoogle().google,
    config,
    db,
    fetchUpstream: upstream.fetchUpstream,
    retryDelaysMs: [0, 0],
    log: silentLogger,
    onRecorded: (report, error) => recorded.push({ report, error }),
  });
  const post = (body: unknown, auth: string | null = token, signal?: AbortSignal) =>
    app.request("/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });
  const rows = () => db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
  return { app, upstream, recorded, post, token, userId, rows };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("auth", () => {
  it("answers health checks without a token", async () => {
    const { app } = await setup();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects missing, unknown and malformed tokens before calling OpenAI", async () => {
    const { post, upstream } = await setup();
    for (const token of [null, "nmb_not-a-real-token", "random"]) {
      const res = await post(validBody, token);
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: { type: string } };
      expect(json.error.type).toBe("authentication_error");
    }
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects revoked and expired tokens and blocked users", async () => {
    const revoked = await setup();
    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(apiTokens.userId, revoked.userId));
    expect((await revoked.post(validBody)).status).toBe(401);

    const expired = await setup();
    await db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.userId, expired.userId));
    expect((await expired.post(validBody)).status).toBe(401);

    const blocked = await setup();
    await db.update(users).set({ status: "blocked" }).where(eq(users.id, blocked.userId));
    expect((await blocked.post(validBody)).status).toBe(401);
  });

  it("stores only the hash and updates last use", async () => {
    const { post, token, userId } = await setup();
    await (await post(validBody)).text();
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.userId, userId));
    expect(row!.tokenHash).not.toContain(token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    for (let i = 0; i < 50; i++) {
      const [fresh] = await db.select().from(apiTokens).where(eq(apiTokens.userId, userId));
      if (fresh!.lastUsedAt) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("last_used_at was not set");
  });
});

describe("proxy", () => {
  it("rejects models we do not pay for and non-streaming calls", async () => {
    const { post, upstream } = await setup();
    expect((await post({ ...validBody, model: "gpt-6-pro" })).status).toBe(400);
    expect((await post({ ...validBody, stream: false })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it("forwards with the server key, forces store off and caps output", async () => {
    const { post, upstream } = await setup();
    await (
      await post({ ...validBody, store: true, max_output_tokens: 999_999, metadata: { x: 1 } })
    ).text();
    const call = upstream.calls[0]!;
    expect(call.url).toBe("https://upstream.test/v1/responses");
    expect(call.headers.get("authorization")).toBe("Bearer sk-server-secret");
    expect(call.body.store).toBe(false);
    expect(call.body.max_output_tokens).toBe(16_000);
    expect(call.body).not.toHaveProperty("metadata");
    expect(call.body.instructions).toBe("Be brief.");
  });

  it("streams the bytes back unchanged", async () => {
    const { post } = await setup();
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe(SSE_EVENTS.map(sse).join(""));
  });

  it("cancels the OpenAI stream when the client stops reading", async () => {
    const { post, upstream } = await setup({ chunks: [sse(SSE_EVENTS[1])], hang: true });
    const res = await post(validBody);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => upstream.state.cancelled);
  });

  it("passes the client abort signal to the OpenAI request", async () => {
    const { post, upstream } = await setup({ hang: true, chunks: [] });
    const controller = new AbortController();
    const res = await post(validBody, undefined, controller.signal);
    expect(res.status).toBe(200);
    controller.abort();
    expect(upstream.calls[0]!.signal?.aborted).toBe(true);
  });

  it("passes request errors through but hides our own key problems", async () => {
    const bad = await setup({ status: 400, errorBody: '{"error":{"message":"bad input"}}' });
    const res400 = await bad.post(validBody);
    expect(res400.status).toBe(400);
    expect(await res400.text()).toContain("bad input");

    const keyProblem = await setup({
      status: 401,
      errorBody: '{"error":{"message":"Incorrect API key sk-..."}}',
    });
    const res401 = await keyProblem.post(validBody);
    expect(res401.status).toBe(502);
    expect(await res401.text()).not.toContain("API key");

    const busy = await setup({ status: 429 });
    expect((await busy.post(validBody)).status).toBe(503);

    const down = await setup({ throws: true });
    expect((await down.post(validBody)).status).toBe(502);
    expect(down.upstream.calls).toHaveLength(3);
    expect((await keyProblem.post(validBody)).headers.get("x-should-retry")).toBe("false");
    expect(keyProblem.upstream.calls).toHaveLength(2);
  });

  it("retries the model service before anything was streamed", async () => {
    const { token } = await issueToken(db, `user${++userCount}@test.dev`, "test");
    const good = fakeUpstream();
    let calls = 0;
    const app = createApp({
      google: fakeGoogle().google,
      config,
      db,
      retryDelaysMs: [0, 0],
      log: silentLogger,
      fetchUpstream: (async (url: string, init?: RequestInit) => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        if (calls === 2) return new Response("{}", { status: 503 });
        return good.fetchUpstream(url, init);
      }) as typeof fetch,
    });
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SSE_EVENTS.map(sse).join(""));
    expect(calls).toBe(3);
  });

  it("refuses bodies over the size limit", async () => {
    const { post, upstream } = await setup();
    const big = { ...validBody, input: "x".repeat(MAX_BODY_BYTES + 10) };
    expect((await post(big)).status).toBe(413);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe("ledger", () => {
  it("records exact usage and cost for a finished call", async () => {
    const { post, recorded, rows } = await setup();
    await (await post(validBody)).text();
    await waitFor(() => recorded.length === 1);
    const [row] = await rows();
    expect(row).toMatchObject({
      model: "gpt-6-luna",
      outcome: "finished",
      responseStatus: "completed",
      inputTokens: 1200,
      cachedTokens: 1000,
      cacheWriteTokens: 200,
      outputTokens: 40,
      estimated: false,
    });
    // 200 written x 0.125 + 1000 cached x 0.01 + 40 out x 0.5 = 55 micro-dollars
    expect(row!.costMicroUsd).toBe(55);
  });

  it("records an estimate when the client cancels mid-stream", async () => {
    const delta = { type: "response.output_text.delta", delta: "x".repeat(400) };
    const { post, recorded, rows } = await setup({ chunks: [sse(delta)], hang: true });
    const res = await post(validBody);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => recorded.length === 1);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "cancelled", estimated: true, cachedTokens: 0 });
    expect(row!.outputTokens).toBe(100);
    expect(row!.inputTokens).toBeGreaterThan(0);
    expect(row!.costMicroUsd).toBeGreaterThan(0);
  });

  it("records the input estimate when the client leaves before the model answers", async () => {
    const { recorded, rows, token } = await setup();
    const controller = new AbortController();
    const slowApp = createApp({
      google: fakeGoogle().google,
      config,
      db,
      log: silentLogger,
      fetchUpstream: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
      onRecorded: (report, error) => recorded.push({ report, error }),
    });
    const pending = slowApp.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(validBody),
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    expect((await pending).status).toBe(499);
    await waitFor(() => recorded.length === 1);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: "client_left", estimated: true, outputTokens: 0 });
  });

  it("does not record failed upstream calls", async () => {
    const { post, recorded, rows } = await setup({ status: 400 });
    await (await post(validBody)).text();
    await new Promise((r) => setTimeout(r, 50));
    expect(recorded).toHaveLength(0);
    expect(await rows()).toHaveLength(0);
  });
});

describe("relay", () => {
  it("pings while the model is quiet and keeps the events intact", async () => {
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await new Promise((r) => setTimeout(r, 60));
        controller.enqueue(encoder.encode(sse(SSE_EVENTS[3])));
        controller.close();
      },
    });
    let end: unknown;
    const text = await new Response(relay(upstream, (e) => (end = e), 20)).text();
    expect(text.startsWith(": ping\n\n")).toBe(true);
    expect(text.replaceAll(": ping\n\n", "")).toBe(sse(SSE_EVENTS[3]));
    expect(end).toMatchObject({ kind: "finished", status: "completed" });
  });
});

describe("FinalEventScanner", () => {
  it("finds usage and counts streamed text even when events are split", () => {
    const scanner = new FinalEventScanner();
    const text = SSE_EVENTS.map(sse).join("").replace(/\n/g, "\r\n");
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 7) scanner.push(bytes.slice(i, i + 7));
    scanner.end();
    expect(scanner.final?.usage).toEqual({
      inputTokens: 1200,
      cachedTokens: 1000,
      cacheWriteTokens: 200,
      outputTokens: 40,
    });
    expect(scanner.streamedChars).toBe("Hello there".length);
  });
});
