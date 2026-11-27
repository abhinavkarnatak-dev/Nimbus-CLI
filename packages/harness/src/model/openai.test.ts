import { describe, expect, it } from "vitest";
import { idleFetch, OpenAIModelClient } from "./openai.js";
import { ConnectionLostError } from "./retry.js";
import type { ModelEvent } from "./types.js";

const encoder = new TextEncoder();
const sse = (events: object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`);

function streamOf(chunks: string[], hang = false): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      const chunk = chunks.shift();
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
      else if (hang) await new Promise(() => {});
      else controller.close();
    },
  });
}

function fakeFetch(body: () => ReadableStream<Uint8Array>): typeof fetch {
  return (async () =>
    new Response(body(), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as typeof fetch;
}

async function run(client: OpenAIModelClient): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  const request = { model: "gpt-6-luna", instructions: "x", input: [] };
  for await (const event of client.stream(request)) events.push(event);
  return events;
}

const completed = {
  type: "response.completed",
  response: { output: [], usage: null },
};

describe("OpenAIModelClient", () => {
  it("yields text and the completed output", async () => {
    const chunks = sse([{ type: "response.output_text.delta", delta: "Hi" }, completed]);
    const client = new OpenAIModelClient({ apiKey: "k", fetch: fakeFetch(() => streamOf(chunks)) });
    const events = await run(client);
    expect(events.map((event) => event.type)).toEqual(["text_delta", "completed"]);
  });

  it("treats a stream that ends early as a lost connection", async () => {
    const chunks = sse([{ type: "response.output_text.delta", delta: "Hi" }]);
    const client = new OpenAIModelClient({ apiKey: "k", fetch: fakeFetch(() => streamOf(chunks)) });
    await expect(run(client)).rejects.toBeInstanceOf(ConnectionLostError);
  });

  it("turns a failed connection into a lost connection", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const client = new OpenAIModelClient({ apiKey: "k", fetch: offline });
    await expect(run(client)).rejects.toBeInstanceOf(ConnectionLostError);
  });

  it("fails a stream that goes quiet", async () => {
    const chunks = sse([{ type: "response.output_text.delta", delta: "Hi" }]);
    const client = new OpenAIModelClient({
      apiKey: "k",
      idleTimeoutMs: 50,
      fetch: fakeFetch(() => streamOf(chunks, true)),
    });
    await expect(run(client)).rejects.toThrow("No data from the server");
  });

  it("does not retry a reply that was cut off on purpose", async () => {
    const chunks = sse([
      {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      },
    ]);
    const client = new OpenAIModelClient({ apiKey: "k", fetch: fakeFetch(() => streamOf(chunks)) });
    const error = await run(client).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(ConnectionLostError);
    expect((error as Error).message).toBe("The reply got too long and was cut off.");
  });

  it("keeps the error code from a stream error event", async () => {
    const chunks = sse([{ type: "error", code: "server_error", message: "Oops", param: null }]);
    const client = new OpenAIModelClient({ apiKey: "k", fetch: fakeFetch(() => streamOf(chunks)) });
    await expect(run(client)).rejects.toMatchObject({ message: "Oops", code: "server_error" });
  });
});

describe("idleFetch", () => {
  it("passes bytes through while they keep coming", async () => {
    const watched = idleFetch(
      50,
      fakeFetch(() => streamOf(["a", "b"])),
    );
    const res = await watched("http://x.test");
    expect(await res.text()).toBe("ab");
  });
});
