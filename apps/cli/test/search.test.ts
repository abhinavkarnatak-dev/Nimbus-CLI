import { FakeModelClient } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { SwitchableModelClient } from "../src/auth/client.js";
import { AuthController } from "../src/auth/controller.js";
import { memoryStore } from "../src/auth/credentials.js";
import { serverSearch, type SearchOptions } from "../src/search.js";

type Reply = Response | ((init?: RequestInit) => Promise<Response>);

function setup(replies: Reply | Reply[], saved = true, options: SearchOptions = {}) {
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const calls: { url: string; init?: RequestInit }[] = [];
  const auth = new AuthController({
    serverUrl: "http://server.test",
    store: memoryStore(saved ? { token: "nmb_t", email: "a@gmail.com" } : null),
    client: new SwitchableModelClient(() => new FakeModelClient([])),
    fetchFn: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
      return typeof reply === "function" ? reply(init) : reply.clone();
    }) as typeof fetch,
    login: async () => ({ token: "x", email: "x" }),
  });
  return { search: serverSearch(auth, { retryDelaysMs: [0, 0], ...options }), calls };
}

const request = { query: "f1 winner", topic: "news" as const, recency: null, maxResults: 5 };
const results = [{ title: "T", url: "https://x.test", content: "C" }];
const signal = () => new AbortController().signal;
const offline = async () => {
  throw new TypeError("fetch failed");
};

describe("serverSearch", () => {
  it("posts to the server with the login token", async () => {
    const { search, calls } = setup(Response.json({ results }));
    expect(await search(request, signal())).toEqual(results);
    expect(calls[0]!.url).toBe("http://server.test/v1/search");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer nmb_t");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(request);
  });

  it("turns server errors into readable errors without retrying them", async () => {
    const { search, calls } = setup(
      Response.json(
        { error: { message: "Web search limit reached for this month." } },
        { status: 503, headers: { "x-should-retry": "false" } },
      ),
    );
    await expect(search(request, signal())).rejects.toThrow("limit reached");
    expect(calls).toHaveLength(1);
  });

  it("retries a dropped connection or a server error", async () => {
    const { search, calls } = setup([
      offline,
      Response.json({ error: { message: "busy" } }, { status: 502 }),
      Response.json({ results }),
    ]);
    expect(await search(request, signal())).toEqual(results);
    expect(calls).toHaveLength(3);
  });

  it("says plainly when the server cannot be reached", async () => {
    const { search, calls } = setup(offline);
    await expect(search(request, signal())).rejects.toThrow("Could not reach the search server.");
    expect(calls).toHaveLength(3);
  });

  it("gives up on a search that hangs", async () => {
    const hang = (init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    const { search, calls } = setup(hang, true, { timeoutMs: 30 });
    await expect(search(request, signal())).rejects.toThrow("Web search timed out after 0.03s.");
    expect(calls).toHaveLength(1);
  });

  it("needs a login", async () => {
    const { search } = setup(Response.json({}), false);
    await expect(search(request, signal())).rejects.toThrow("Not logged in");
  });
});
