import {
  isNetworkError,
  isRetryable,
  sleep,
  type SearchFn,
  type SearchRequest,
  type SearchResult,
} from "@nimbus/harness";
import type { AuthController } from "./auth/controller.js";

export interface SearchOptions {
  timeoutMs?: number;
  retryDelaysMs?: number[];
}

const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_RETRY_DELAYS_MS = [1000, 3000];

async function searchOnce(
  auth: AuthController,
  request: SearchRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<SearchResult[]> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await auth.authedFetch("/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    // Already waited long, so a timeout is not retried
    if (timeout.aborted && !signal?.aborted) {
      throw new Error(`Web search timed out after ${timeoutMs / 1000}s.`, { cause: error });
    }
    throw error;
  }
  const body = (await res.json().catch(() => ({}))) as {
    results?: SearchResult[];
    error?: { message?: string };
  };
  if (!res.ok) {
    const message = body.error?.message ?? `Web search failed (${res.status}).`;
    throw Object.assign(new Error(message), { status: res.status, headers: res.headers });
  }
  return body.results ?? [];
}

// Web search through the Nimbus server, retried on network trouble
export function serverSearch(auth: AuthController, options: SearchOptions = {}): SearchFn {
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const delays = options.retryDelaysMs ?? SEARCH_RETRY_DELAYS_MS;
  return async (request, signal) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await searchOnce(auth, request, signal, timeoutMs);
      } catch (error) {
        const last = attempt >= delays.length;
        if (signal?.aborted || last || !isRetryable(error)) {
          if (!signal?.aborted && isNetworkError(error)) {
            throw new Error("Could not reach the search server.", { cause: error });
          }
          throw error;
        }
        await sleep(delays[attempt]!, signal);
      }
    }
  };
}
