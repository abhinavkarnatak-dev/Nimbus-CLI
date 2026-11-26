import { z } from "zod";
import { defineTool } from "./types.js";

const schema = z.strictObject({
  query: z.string().min(2).max(400),
  topic: z.enum(["general", "news"]).nullable(),
  recency: z.enum(["day", "week", "month", "year"]).nullable(),
  max_results: z.number().int().min(1).max(8).nullable(),
});

export const webSearchTool = defineTool({
  name: "web_search",
  description: `Search the web for up-to-date information on any topic. Use it whenever the
answer depends on facts you may not know or that may have changed since your
training, for example:
- current facts: who holds a position, prices, rankings, laws, product details
- news and recent events: sports results, launches, announcements
- technical facts: library versions, API docs, error messages, release notes

Returns the top results with title, URL, date when known, and a short extract.

- Do not guess about people, events or anything time sensitive. Search instead.
- For code in this project, read the project files first (read_file, grep).
- Write focused queries, like you would type into a search engine. Include
  names, dates, version numbers or the exact error text.
- Use topic "news" for recent events, and recency to limit how old results can be.
- For the version of a package or tool, run its package manager with bash
  instead when you can (for example npm view hono version). It is exact and free.
- Usually one search is enough, two at most. Do not repeat a search with small
  wording changes or site: filters. If the results are unclear or disagree, say
  so instead of searching again.
- Mention the sources (URLs) you relied on in your answer.
- topic: "general" or "news". Use null for general.
- recency: "day", "week", "month" or "year". Use null for any age.
- max_results: 1 to 8. Use null for 5.`,
  schema,
  // Ask the app's search provider
  async run({ query, topic, recency, max_results }, ctx) {
    if (!ctx.search) throw new Error("web search is not available in this session");
    const results = await ctx.search(
      { query, topic: topic ?? "general", recency, maxResults: max_results ?? 5 },
      ctx.signal,
    );
    if (results.length === 0) {
      return { output: `No results for "${query}".`, summary: "0 results" };
    }
    const output = results
      .map((result, index) => {
        const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];
        if (result.publishedDate) lines.push(`   Published ${result.publishedDate}`);
        lines.push(`   ${result.content.replace(/\s+/g, " ").trim()}`);
        return lines.join("\n");
      })
      .join("\n\n");
    return {
      output,
      summary: `${results.length} result${results.length === 1 ? "" : "s"}`,
    };
  },
});
