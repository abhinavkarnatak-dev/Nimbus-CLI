import { z } from "zod";
import type { Context } from "hono";
import { apiError } from "../errors.js";
import type { Logger } from "../log.js";
import { responsesRequestSchema, upstreamBody } from "./request.js";
import { relay, type StreamEnd } from "./usage.js";

export interface StreamReport {
  model: string;
  end: StreamEnd;
  durationMs: number;
}

export interface ProxyDeps {
  upstreamUrl: string;
  apiKey: string;
  maxOutputTokens: number;
  fetchUpstream: typeof fetch;
  log: Logger;
  onStreamEnd?: (report: StreamReport) => void;
}

// Upstream errors that are about the request itself
const CLIENT_ERRORS = new Set([400, 404, 413, 422]);

// Forward one Responses API call and stream it back
export function responsesHandler(deps: ProxyDeps) {
  return async (c: Context) => {
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

    const model = parsed.data.model;
    const signal = c.req.raw.signal;
    const started = Date.now();

    let upstream: Response;
    try {
      upstream = await deps.fetchUpstream(`${deps.upstreamUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${deps.apiKey}`,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(upstreamBody(parsed.data, deps.maxOutputTokens)),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        deps.log("info", "client left before the model answered", { model });
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
      return apiError(c, 502, "The model service returned an error.", "server_error");
    }

    const body = relay(upstream.body, (end) => {
      const durationMs = Date.now() - started;
      deps.log(end.kind === "upstream_error" ? "warn" : "info", "stream ended", {
        model,
        durationMs,
        ...end,
      });
      deps.onStreamEnd?.({ model, end, durationMs });
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  };
}
