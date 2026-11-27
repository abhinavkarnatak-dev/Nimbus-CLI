import type { Context } from "hono";
import { z } from "zod";
import type { TokenOwner } from "../db/tokens.js";
import type { AppEnv } from "../env.js";
import { apiError } from "../errors.js";
import type { Logger } from "../log.js";
import { responsesRequestSchema, upstreamBody, type ResponsesRequest } from "./request.js";
import { fetchWithRetry } from "../retry.js";
import { relay, type StreamEnd } from "./usage.js";

export type CallEnd = StreamEnd | { kind: "client_left" };

export interface CallReport {
  auth: TokenOwner;
  model: string;
  promptCacheKey?: string;
  end: CallEnd;
  durationMs: number;
  requestChars: number;
  streamedChars: number;
}

export interface ProxyDeps {
  upstreamUrl: string;
  apiKey: string;
  maxOutputTokens: number;
  fetchUpstream: typeof fetch;
  retryDelaysMs?: number[];
  log: Logger;
  onCallEnd: (report: CallReport) => void;
}

// Characters that are billed as text: encrypted reasoning is left out
export function billableChars(request: ResponsesRequest): number {
  const skipEncrypted = (key: string, value: unknown) =>
    key === "encrypted_content" ? undefined : value;
  return (
    (request.instructions?.length ?? 0) +
    JSON.stringify(request.input, skipEncrypted).length +
    JSON.stringify(request.tools ?? []).length
  );
}

// Upstream errors that are about the request itself
const CLIENT_ERRORS = new Set([400, 404, 413, 422]);

// Forward one Responses API call and stream it back
export function responsesHandler(deps: ProxyDeps) {
  return async (c: Context<AppEnv>) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return apiError(c, 400, "Request body is not valid JSON.", "invalid_request_error");
    }

    const parsed = responsesRequestSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(c, 400, z.prettifyError(parsed.error), "invalid_request_error");
    }

    const auth = c.get("auth");
    const model = parsed.data.model;
    const signal = c.req.raw.signal;
    const started = Date.now();
    const body = JSON.stringify(upstreamBody(parsed.data, deps.maxOutputTokens));
    const requestChars = billableChars(parsed.data);
    const report = (end: CallEnd, streamedChars: number) =>
      deps.onCallEnd({
        auth,
        model,
        promptCacheKey: parsed.data.prompt_cache_key,
        end,
        durationMs: Date.now() - started,
        requestChars,
        streamedChars,
      });

    let upstream: Response;
    try {
      upstream = await fetchWithRetry(
        deps.fetchUpstream,
        `${deps.upstreamUrl}/responses`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.apiKey}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body,
          signal,
        },
        deps.retryDelaysMs,
      );
    } catch (error) {
      if (signal.aborted) {
        deps.log("info", "client left before the model answered", { model });
        report({ kind: "client_left" }, 0);
        return new Response(null, { status: 499 });
      }
      deps.log("error", "model service unreachable", { model, error: (error as Error).message });
      return apiError(c, 502, "Could not reach the model service.", "server_error");
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      deps.log("warn", "model service returned an error", {
        model,
        status: upstream.status,
        body: text.slice(0, 500),
      });
      if (CLIENT_ERRORS.has(upstream.status)) {
        return new Response(text, {
          status: upstream.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (upstream.status === 429) {
        return apiError(c, 503, "The model service is busy. Try again shortly.", "server_error");
      }
      // Our key is broken, so retrying from the CLI cannot help
      if (upstream.status === 401 || upstream.status === 403) c.header("x-should-retry", "false");
      return apiError(c, 502, "The model service returned an error.", "server_error");
    }

    const stream = relay(upstream.body, (end, streamedChars) => {
      deps.log(end.kind === "upstream_error" ? "warn" : "info", "stream ended", {
        model,
        user: auth.userId,
        durationMs: Date.now() - started,
        ...end,
      });
      report(end, streamedChars);
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  };
}
