import type { Context } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { recordSearch, searchesThisMonth } from "../db/ledger.js";
import type { AppEnv } from "../env.js";
import { apiError } from "../errors.js";
import type { Logger } from "../log.js";

export const MAX_EXTRACT_CHARS = 1200;

const searchSchema = z.object({
  query: z.string().min(2).max(400),
  topic: z.enum(["general", "news"]).default("general"),
  recency: z.enum(["day", "week", "month", "year"]).nullable().default(null),
  maxResults: z.number().int().min(1).max(8).default(5),
});

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
}

export interface SearchDeps {
  db: Db;
  apiKey?: string;
  baseUrl: string;
  monthlyLimit: number;
  fetchFn: typeof fetch;
  log: Logger;
  onCost: (cost: number) => void;
}

const clip = (text: string) =>
  text.length > MAX_EXTRACT_CHARS ? `${text.slice(0, MAX_EXTRACT_CHARS)}...` : text;

// Web search through Tavily, billed to the user like model calls
export function searchHandler(deps: SearchDeps) {
  return async (c: Context<AppEnv>) => {
    if (!deps.apiKey) {
      return apiError(c, 503, "Web search is not configured on this server.", "server_error");
    }
    const parsed = searchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return apiError(c, 400, z.prettifyError(parsed.error), "invalid_request_error");
    }
    if ((await searchesThisMonth(deps.db)) >= deps.monthlyLimit) {
      return apiError(c, 503, "Web search limit reached for this month.", "server_error");
    }

    const { query, topic, recency, maxResults } = parsed.data;
    const started = Date.now();
    let res: Response;
    try {
      res = await deps.fetchFn(`${deps.baseUrl}/search`, {
        method: "POST",
        headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          query,
          topic,
          search_depth: "basic",
          max_results: maxResults,
          time_range: recency,
          include_answer: false,
          include_raw_content: false,
          include_published_date: true,
        }),
        signal: c.req.raw.signal,
      });
    } catch (error) {
      deps.log("error", "search service unreachable", { error: (error as Error).message });
      return apiError(c, 502, "Could not reach the search service.", "server_error");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      deps.log("warn", "search service returned an error", {
        status: res.status,
        body: text.slice(0, 300),
      });
      if (res.status === 400) {
        return apiError(c, 400, "The search request was not accepted.", "invalid_request_error");
      }
      if (res.status === 429 || res.status === 432 || res.status === 433) {
        return apiError(c, 503, "Web search is busy or out of credits.", "server_error");
      }
      return apiError(c, 502, "The search service returned an error.", "server_error");
    }

    const body = (await res.json().catch(() => ({}))) as { results?: TavilyResult[] };
    const results = (body.results ?? [])
      .filter((result) => result.url)
      .slice(0, maxResults)
      .map((result) => ({
        title: result.title?.trim() || result.url!,
        url: result.url!,
        content: clip((result.content ?? "").trim()),
        ...(result.published_date ? { publishedDate: result.published_date } : {}),
      }));

    const auth = c.get("auth");
    try {
      deps.onCost(
        await recordSearch(deps.db, {
          userId: auth.userId,
          tokenId: auth.tokenId,
          durationMs: Date.now() - started,
        }),
      );
    } catch (error) {
      deps.log("error", "could not record search", { error: (error as Error).message });
    }
    deps.log("info", "search done", { user: auth.userId, results: results.length });
    return c.json({ results });
  };
}
