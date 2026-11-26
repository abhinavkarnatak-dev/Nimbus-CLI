import { describe, expect, it } from "vitest";
import { FileTracker } from "./file-state.js";
import type { SearchFn, SearchRequest } from "./types.js";
import { webSearchTool } from "./web-search.js";

const run = (args: object, search?: SearchFn) =>
  webSearchTool.execute(JSON.stringify(args), {
    cwd: "/",
    signal: new AbortController().signal,
    files: new FileTracker(),
    search,
  });

const blank = { topic: null, recency: null, max_results: null };

describe("web_search", () => {
  it("formats results with title, URL, date and a one line extract", async () => {
    let seen: SearchRequest | undefined;
    const result = await run({ ...blank, query: "who won the f1 race" }, async (request) => {
      seen = request;
      return [
        {
          title: "Race report",
          url: "https://example.com/race",
          content: "The winner\n  was   fast.",
          publishedDate: "2026-11-23",
        },
        { title: "Standings", url: "https://example.com/standings", content: "Table" },
      ];
    });
    expect(seen).toEqual({
      query: "who won the f1 race",
      topic: "general",
      recency: null,
      maxResults: 5,
    });
    expect(result.summary).toBe("2 results");
    expect(result.output).toBe(
      [
        "1. Race report",
        "   https://example.com/race",
        "   Published 2026-11-23",
        "   The winner was fast.",
        "",
        "2. Standings",
        "   https://example.com/standings",
        "   Table",
      ].join("\n"),
    );
  });

  it("passes topic, recency and result count through", async () => {
    let seen: SearchRequest | undefined;
    await run({ query: "launch", topic: "news", recency: "week", max_results: 3 }, async (r) => {
      seen = r;
      return [];
    });
    expect(seen).toMatchObject({ topic: "news", recency: "week", maxResults: 3 });
  });

  it("says when nothing was found", async () => {
    const result = await run({ ...blank, query: "zzzz" }, async () => []);
    expect(result).toMatchObject({ output: 'No results for "zzzz".', summary: "0 results" });
  });

  it("returns errors to the model", async () => {
    const failing = await run({ ...blank, query: "x y" }, async () => {
      throw new Error("Web search limit reached for this month.");
    });
    expect(failing).toMatchObject({ isError: true });
    expect(failing.output).toContain("limit reached");

    const missing = await run({ ...blank, query: "x y" });
    expect(missing.output).toContain("not available");

    const tooMany = await run({ ...blank, query: "x y", max_results: 50 }, async () => []);
    expect(tooMany.isError).toBe(true);
  });
});
