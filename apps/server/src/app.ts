import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bearerToken, tokenMatches } from "./auth.js";
import type { ServerConfig } from "./config.js";
import { apiError } from "./errors.js";
import { jsonLogger, type Logger } from "./log.js";
import { responsesHandler, type StreamReport } from "./proxy/route.js";

export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface AppDeps {
  config: Pick<ServerConfig, "openaiApiKey" | "openaiBaseUrl" | "devToken" | "maxOutputTokens">;
  fetchUpstream?: typeof fetch;
  log?: Logger;
  onStreamEnd?: (report: StreamReport) => void;
}

export function createApp(deps: AppDeps) {
  const log = deps.log ?? jsonLogger;
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Every /v1 route needs a valid token
  app.use("/v1/*", async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token || !tokenMatches(token, deps.config.devToken)) {
      return apiError(c, 401, "Missing or invalid Nimbus token.", "authentication_error");
    }
    await next();
  });

  app.post(
    "/v1/responses",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => apiError(c, 413, "Request is too large.", "invalid_request_error"),
    }),
    responsesHandler({
      upstreamUrl: deps.config.openaiBaseUrl,
      apiKey: deps.config.openaiApiKey,
      maxOutputTokens: deps.config.maxOutputTokens,
      fetchUpstream: deps.fetchUpstream ?? fetch,
      log,
      onStreamEnd: deps.onStreamEnd,
    }),
  );

  app.notFound((c) => apiError(c, 404, "Not found.", "invalid_request_error"));
  app.onError((error, c) => {
    log("error", "unhandled error", { error: error.message });
    return apiError(c, 500, "Internal server error.", "server_error");
  });

  return app;
}
