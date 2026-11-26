import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bearerToken } from "./auth.js";
import { usageFromReport } from "./billing.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { recordUsage } from "./db/ledger.js";
import { findTokenOwner, touchToken } from "./db/tokens.js";
import type { AppEnv } from "./env.js";
import { apiError } from "./errors.js";
import { jsonLogger, type Logger } from "./log.js";
import { responsesHandler, type CallReport } from "./proxy/route.js";

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export interface AppDeps {
  config: Pick<ServerConfig, "openaiApiKey" | "openaiBaseUrl" | "maxOutputTokens">;
  db: Db;
  fetchUpstream?: typeof fetch;
  log?: Logger;
  // Resolves once the ledger write is done (used by tests)
  onRecorded?: (report: CallReport, error?: unknown) => void;
}

export function createApp(deps: AppDeps) {
  const log = deps.log ?? jsonLogger;
  const { db } = deps;
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  // Every /v1 route needs a valid token from the database
  app.use("/v1/*", async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) {
      return apiError(c, 401, "Missing Nimbus token.", "authentication_error");
    }
    let owner;
    try {
      owner = await findTokenOwner(db, token);
    } catch (error) {
      log("error", "token lookup failed", { error: (error as Error).message });
      return apiError(c, 503, "Nimbus is having trouble. Try again shortly.", "server_error");
    }
    if (!owner) {
      return apiError(c, 401, "Invalid or revoked Nimbus token.", "authentication_error");
    }
    const stale = !owner.lastUsedAt || Date.now() - owner.lastUsedAt.getTime() > TOUCH_EVERY_MS;
    if (stale) {
      touchToken(db, owner.tokenId).catch((error: Error) =>
        log("warn", "could not update last_used_at", { error: error.message }),
      );
    }
    c.set("auth", owner);
    await next();
  });

  // Write the ledger row without holding up the stream
  const onCallEnd = (report: CallReport) => {
    recordUsage(db, usageFromReport(report))
      .then(() => deps.onRecorded?.(report))
      .catch((error: Error) => {
        log("error", "could not record usage", {
          error: error.message,
          user: report.auth.userId,
          model: report.model,
        });
        deps.onRecorded?.(report, error);
      });
  };

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
      onCallEnd,
    }),
  );

  app.notFound((c) => apiError(c, 404, "Not found.", "invalid_request_error"));
  app.onError((error, c) => {
    log("error", "unhandled error", { error: error.message });
    return apiError(c, 500, "Internal server error.", "server_error");
  });

  return app;
}
