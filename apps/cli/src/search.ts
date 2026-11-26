import type { SearchFn, SearchResult } from "@nimbus/harness";
import type { AuthController } from "./auth/controller.js";

// Web search through the Nimbus server
export function serverSearch(auth: AuthController): SearchFn {
  return async (request, signal) => {
    const res = await auth.authedFetch("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      results?: SearchResult[];
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(body.error?.message ?? `Web search failed (${res.status}).`);
    return body.results ?? [];
  };
}
