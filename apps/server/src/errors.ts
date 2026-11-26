import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "insufficient_quota"
  | "rate_limit_error"
  | "server_error";

// Same error shape as OpenAI, so the SDK shows the message
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
  type: ErrorType,
) {
  return c.json({ error: { message, type, code: null } }, status);
}
