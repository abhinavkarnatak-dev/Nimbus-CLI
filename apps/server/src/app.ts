import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bearerToken } from "./auth/bearer.js";
import type { GoogleAuth } from "./auth/google.js";
import { authRoutes } from "./auth/routes.js";
import { needsEstimate, usageFromReport } from "./billing.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { lastCachedRatio, recordUsage } from "./db/ledger.js";
import { findTokenOwner, revokeToken, touchToken } from "./db/tokens.js";
import type { AppEnv } from "./env.js";
import { apiError } from "./errors.js";
import { SpendTracker, UserLimits } from "./limits.js";
import { jsonLogger, type Logger } from "./log.js";
import { responsesHandler, type CallReport } from "./proxy/route.js";
import { searchHandler } from "./search/route.js";

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

type LimitSettings = Pick<
  ServerConfig,
  "trialQuotaMicroUsd" | "globalBudgetMicroUsd" | "paused" | "maxConcurrent" | "ratePerMinute"
>;

const DEFAULT_LIMITS: LimitSettings = {
  trialQuotaMicroUsd: 500_000,
  globalBudgetMicroUsd: 8_000_000,
  paused: false,
  maxConcurrent: 3,
  ratePerMinute: 60,
};

type SearchSettings = Pick<ServerConfig, "tavilyApiKey" | "tavilyBaseUrl" | "searchMonthlyLimit">;

export interface AppDeps {
  siteUrl?: string;
  config: Pick<ServerConfig, "openaiApiKey" | "openaiBaseUrl" | "maxOutputTokens"> &
    Partial<LimitSettings> &
    Partial<SearchSettings>;
  db: Db;
  google: GoogleAuth;
  fetchUpstream?: typeof fetch;
  fetchSearch?: typeof fetch;
  log?: Logger;
  // Resolves once the ledger write is done (used by tests)
  onRecorded?: (report: CallReport, error?: unknown) => void;
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

// Run a function when a streamed body finishes or is cancelled
function onClose(body: ReadableStream<Uint8Array>, done: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) {
          done();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        done();
        controller.error(error);
      }
    },
    async cancel(reason) {
      done();
      await reader.cancel(reason).catch(() => {});
    },
  });
}

export function createApp(deps: AppDeps) {
  const log = deps.log ?? jsonLogger;
  const { db } = deps;
  const limits: LimitSettings = { ...DEFAULT_LIMITS, ...deps.config };
  const userLimits = new UserLimits(limits.maxConcurrent, limits.ratePerMinute);
  const spend = new SpendTracker(db);
  const quotaOf = (quota: number | null) => quota ?? limits.trialQuotaMicroUsd;
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/auth", authRoutes({ db, google: deps.google, log, siteUrl: deps.siteUrl }));

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

  // Budget checks before any money is spent
  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (limits.paused) {
      return apiError(c, 503, "Nimbus is paused right now. Try again later.", "server_error");
    }
    await spend
      .refreshIfStale()
      .catch((error: Error) =>
        log("warn", "could not refresh total spend", { error: error.message }),
      );
    if (spend.total >= limits.globalBudgetMicroUsd) {
      log("warn", "global budget reached", { total: spend.total });
      return apiError(
        c,
        503,
        "Nimbus has reached its usage limit for now. Try again later.",
        "server_error",
      );
    }
    const auth = c.get("auth");
    const quota = quotaOf(auth.quotaMicroUsd);
    if (auth.spentMicroUsd >= quota) {
      return apiError(
        c,
        402,
        `Your Nimbus trial credit is used up (${usd(quota)}).`,
        "insufficient_quota",
      );
    }
    const slot = userLimits.acquire(auth.userId);
    if ("refused" in slot) {
      c.header("retry-after", slot.refused === "rate" ? "20" : "2");
      return apiError(
        c,
        429,
        slot.refused === "rate"
          ? "Too many requests. Slow down a little."
          : "Too many requests at once. Wait for one to finish.",
        "rate_limit_error",
      );
    }
    try {
      await next();
    } catch (error) {
      slot.release();
      throw error;
    }
    const body = c.res.body;
    if (body && c.res.headers.get("content-type")?.includes("text/event-stream")) {
      c.res = new Response(onClose(body, slot.release), c.res);
    } else {
      slot.release();
    }
  };

  app.get("/v1/me", (c) => {
    const auth = c.get("auth");
    return c.json({
      email: auth.email,
      spentMicroUsd: auth.spentMicroUsd,
      quotaMicroUsd: quotaOf(auth.quotaMicroUsd),
    });
  });

  // Revoke the token used for this request
  app.post("/v1/auth/logout", async (c) => {
    await revokeToken(db, c.get("auth").tokenId);
    return c.body(null, 204);
  });

  // Write the ledger row without holding up the stream
  const onCallEnd = (report: CallReport) => {
    void (async () => {
      const ratio = needsEstimate(report)
        ? await lastCachedRatio(db, report.auth.userId, report.promptCacheKey)
        : 0;
      spend.add(await recordUsage(db, usageFromReport(report, ratio)));
    })()
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
    guard,
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

  app.post(
    "/v1/search",
    guard,
    searchHandler({
      db,
      apiKey: deps.config.tavilyApiKey,
      baseUrl: deps.config.tavilyBaseUrl ?? "https://api.tavily.com",
      monthlyLimit: deps.config.searchMonthlyLimit ?? 900,
      fetchFn: deps.fetchSearch ?? fetch,
      log,
      onCost: (cost) => spend.add(cost),
    }),
  );

  app.notFound((c) => apiError(c, 404, "Not found.", "invalid_request_error"));
  app.onError((error, c) => {
    log("error", "unhandled error", { error: error.message });
    return apiError(c, 500, "Internal server error.", "server_error");
  });

  return app;
}
