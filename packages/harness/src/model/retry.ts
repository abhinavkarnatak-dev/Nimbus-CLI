// Model calls retry this many times before the turn fails
export const MAX_RETRIES = 5;
// Same wait before every retry
export const RETRY_DELAY_MS = 10_000;
const MAX_ASKED_DELAY_MS = 60_000;

// The connection dropped, stalled or closed too early
export class ConnectionLostError extends Error {
  override name = "ConnectionLostError";
}

// Codes Node and undici use when a connection fails
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CLOSED",
]);

const RETRY_STATUSES = new Set([408, 409, 429]);
// Codes on stream error events that are worth another try
const RETRY_CODES = new Set(["server_error", "rate_limit_exceeded"]);

interface ErrorFields {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  type?: unknown;
  headers?: unknown;
  cause?: unknown;
}

function header(error: ErrorFields, name: string): string | undefined {
  const { headers } = error;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (headers && typeof headers === "object") {
    const value = (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

// No answer at all: offline, DNS, reset or stalled
export function isNetworkError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  if (error instanceof ConnectionLostError) return true;
  const { code, message, cause } = error as ErrorFields;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
  if (error instanceof TypeError && /fetch failed|terminated|network/i.test(String(message))) {
    return true;
  }
  return isNetworkError(cause, depth + 1);
}

// Network drops and server trouble are worth another try
export function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const fields = error as ErrorFields;
  if (fields.name === "AbortError") return false;
  const told = header(fields, "x-should-retry");
  if (told === "false") return false;
  if (told === "true") return true;
  if (fields.code === "insufficient_quota" || fields.type === "insufficient_quota") return false;
  if (typeof fields.status === "number") {
    return RETRY_STATUSES.has(fields.status) || fields.status >= 500;
  }
  if (typeof fields.code === "string" && RETRY_CODES.has(fields.code)) return true;
  return isNetworkError(error);
}

// Wait the server asked for, if it said
function askedDelayMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const fields = error as ErrorFields;
  const msHeader = header(fields, "retry-after-ms");
  if (msHeader) {
    const ms = Number(msHeader);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  const after = header(fields, "retry-after");
  if (!after) return undefined;
  const seconds = Number(after);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(after);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

// 10s every time, longer only if the server asks
export function retryDelayMs(error: unknown): number {
  const asked = askedDelayMs(error);
  if (asked !== undefined && asked > RETRY_DELAY_MS && asked <= MAX_ASKED_DELAY_MS) return asked;
  return RETRY_DELAY_MS;
}

// Short reason the UI shows while waiting
export function retryReason(error: unknown): string {
  const status = (error as ErrorFields | null)?.status;
  if (status === 429) return "Server busy";
  if (typeof status === "number") return "Server error";
  if (isNetworkError(error)) return "Connection lost";
  return "Server error";
}

// Sleep that ends early when the user stops
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
