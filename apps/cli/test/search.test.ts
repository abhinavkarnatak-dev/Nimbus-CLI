import { FakeModelClient } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { SwitchableModelClient } from "../src/auth/client.js";
import { AuthController } from "../src/auth/controller.js";
import { memoryStore } from "../src/auth/credentials.js";
import { serverSearch } from "../src/search.js";

function setup(response: Response, saved = true) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const auth = new AuthController({
    serverUrl: "http://server.test",
    store: memoryStore(saved ? { token: "nmb_t", email: "a@gmail.com" } : null),
    client: new SwitchableModelClient(() => new FakeModelClient([])),
    fetchFn: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return response;
    }) as typeof fetch,
    login: async () => ({ token: "x", email: "x" }),
  });
  return { search: serverSearch(auth), calls };
}

const request = { query: "f1 winner", topic: "news" as const, recency: null, maxResults: 5 };

describe("serverSearch", () => {
  it("posts to the server with the login token", async () => {
    const results = [{ title: "T", url: "https://x.test", content: "C" }];
    const { search, calls } = setup(Response.json({ results }));
    expect(await search(request, new AbortController().signal)).toEqual(results);
    expect(calls[0]!.url).toBe("http://server.test/v1/search");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer nmb_t");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(request);
  });

  it("turns server errors into readable errors", async () => {
    const { search } = setup(
      Response.json(
        { error: { message: "Web search limit reached for this month." } },
        { status: 503 },
      ),
    );
    await expect(search(request, new AbortController().signal)).rejects.toThrow("limit reached");
  });

  it("needs a login", async () => {
    const { search } = setup(Response.json({}), false);
    await expect(search(request, new AbortController().signal)).rejects.toThrow("Not logged in");
  });
});
