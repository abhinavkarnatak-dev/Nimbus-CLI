import { describe, expect, it } from "vitest";
import { createApp, MAX_BODY_BYTES } from "../src/app.js";
import { silentLogger } from "../src/log.js";
import type { StreamReport } from "../src/proxy/route.js";
import { FinalEventScanner } from "../src/proxy/usage.js";
import { fakeUpstream, SSE_EVENTS, sse } from "./fake-upstream.js";

const config = {
  openaiApiKey: "sk-server-secret",
  openaiBaseUrl: "https://upstream.test/v1",
  devToken: "dev-token",
  maxOutputTokens: 16_000,
};

const validBody = {
  model: "gpt-6-luna",
  input: [{ role: "user", content: "hi" }],
  instructions: "Be brief.",
  store: false,
  stream: true,
};

function setup(upstreamOptions?: Parameters<typeof fakeUpstream>[0]) {
  const upstream = fakeUpstream(upstreamOptions);
  const reports: StreamReport[] = [];
  const app = createApp({
    config,
    fetchUpstream: upstream.fetchUpstream,
    log: silentLogger,
    onStreamEnd: (report) => reports.push(report),
  });
  const post = (body: unknown, token: string | null = "dev-token", signal?: AbortSignal) =>
    app.request("/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });
  return { app, upstream, reports, post };
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe("server", () => {
  it("answers health checks without a token", async () => {
    const { app } = setup();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects missing and wrong tokens before calling OpenAI", async () => {
    const { post, upstream } = setup();
    for (const token of [null, "wrong"]) {
      const res = await post(validBody, token);
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: { type: string } };
      expect(json.error.type).toBe("authentication_error");
    }
    expect(upstream.calls).toHaveLength(0);
  });

  it("rejects models we do not pay for and non-streaming calls", async () => {
    const { post, upstream } = setup();
    expect((await post({ ...validBody, model: "gpt-6-pro" })).status).toBe(400);
    expect((await post({ ...validBody, stream: false })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it("forwards with the server key, forces store off and caps output", async () => {
    const { post, upstream } = setup();
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

  it("streams the bytes back unchanged and reports usage", async () => {
    const { post, reports } = setup();
    const res = await post(validBody);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe(SSE_EVENTS.map(sse).join(""));
    expect(reports).toHaveLength(1);
    expect(reports[0]!.end).toEqual({
      kind: "finished",
      status: "completed",
      usage: { inputTokens: 1200, cachedTokens: 1000, outputTokens: 40 },
    });
  });

  it("cancels the OpenAI stream when the client stops reading", async () => {
    const { post, upstream, reports } = setup({ chunks: [sse(SSE_EVENTS[1])], hang: true });
    const res = await post(validBody);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => upstream.state.cancelled);
    expect(reports[0]!.end).toEqual({ kind: "cancelled" });
  });

  it("passes the client abort signal to the OpenAI request", async () => {
    const { post, upstream } = setup({ hang: true, chunks: [] });
    const controller = new AbortController();
    const res = await post(validBody, "dev-token", controller.signal);
    expect(res.status).toBe(200);
    controller.abort();
    expect(upstream.calls[0]!.signal?.aborted).toBe(true);
  });

  it("passes request errors through but hides our own key problems", async () => {
    const bad = setup({ status: 400, errorBody: '{"error":{"message":"bad input"}}' });
    const res400 = await bad.post(validBody);
    expect(res400.status).toBe(400);
    expect(await res400.text()).toContain("bad input");

    const keyProblem = setup({
      status: 401,
      errorBody: '{"error":{"message":"Incorrect API key sk-..."}}',
    });
    const res401 = await keyProblem.post(validBody);
    expect(res401.status).toBe(502);
    expect(await res401.text()).not.toContain("API key");

    const busy = setup({ status: 429 });
    expect((await busy.post(validBody)).status).toBe(503);

    const down = setup({ throws: true });
    expect((await down.post(validBody)).status).toBe(502);
  });

  it("refuses bodies over the size limit", async () => {
    const { post, upstream } = setup();
    const big = { ...validBody, input: "x".repeat(MAX_BODY_BYTES + 10) };
    expect((await post(big)).status).toBe(413);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe("FinalEventScanner", () => {
  it("finds usage even when events are split across chunks", () => {
    const scanner = new FinalEventScanner();
    const text = SSE_EVENTS.map(sse).join("").replace(/\n/g, "\r\n");
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.length; i += 7) scanner.push(bytes.slice(i, i + 7));
    scanner.end();
    expect(scanner.final?.usage).toEqual({
      inputTokens: 1200,
      cachedTokens: 1000,
      outputTokens: 40,
    });
  });
});
