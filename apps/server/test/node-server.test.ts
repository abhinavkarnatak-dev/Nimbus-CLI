import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { issueToken } from "../src/db/tokens.js";
import { silentLogger } from "../src/log.js";
import { testDb } from "./db.js";
import { fakeUpstream, SSE_EVENTS, sse } from "./fake-upstream.js";

let server: ServerType | undefined;
afterEach(() => server?.close());

describe("real HTTP server", () => {
  it("stops the OpenAI request when the client disconnects mid-stream", async () => {
    const upstream = fakeUpstream({ chunks: [sse(SSE_EVENTS[1])], hang: true });
    const { db, client } = await testDb();
    const { token } = await issueToken(db, "net@test.dev", "test");
    const app = createApp({
      db,
      config: {
        openaiApiKey: "sk",
        openaiBaseUrl: "https://upstream.test/v1",
        maxOutputTokens: 100,
      },
      fetchUpstream: upstream.fetchUpstream,
      log: silentLogger,
    });
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-6-luna", input: "hi", stream: true }),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("Hello");

    controller.abort();
    for (let i = 0; i < 100 && !upstream.state.cancelled; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(upstream.state.cancelled).toBe(true);
    expect(upstream.calls[0]!.signal?.aborted).toBe(true);
    await client.close();
  });
});
