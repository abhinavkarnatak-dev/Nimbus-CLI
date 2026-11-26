import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Credentials } from "./credentials.js";

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface LoginOptions {
  serverUrl: string;
  label: string;
  inviteCode?: string;
  openBrowser: (url: string) => Promise<unknown>;
  onUrl?: (url: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const ERROR_TEXT: Record<string, string> = {
  access_denied: "Login was cancelled in the browser.",
  email_not_verified: "Your Google email is not verified.",
  account_blocked: "This account is blocked.",
  google_failed: "Google login failed. Try again.",
  not_invited: "Nimbus is invite only for now. Got an invite code? Run /login <code>.",
  invalid_code: "That invite code is not valid, used up or expired.",
};

export class LoginError extends Error {}

const s256 = (value: string) => createHash("sha256").update(value).digest("base64url");

// Browser login: local callback server + PKCE, returns a saved-ready token
export async function browserLogin(options: LoginOptions): Promise<Credentials> {
  const fetchFn = options.fetchFn ?? fetch;
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("base64url");

  let settle!: { resolve: (value: Credentials) => void; reject: (error: Error) => void };
  const result = new Promise<Credentials>((resolve, reject) => {
    settle = { resolve, reject };
  });

  // The tab ends on a Nimbus page, never on this local address
  const finish = (res: ServerResponse, reason: string | null) => {
    const target = reason
      ? `${options.serverUrl}/auth/cli/failed?reason=${encodeURIComponent(reason)}`
      : `${options.serverUrl}/auth/cli/done`;
    res.writeHead(302, { location: target });
    res.end();
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error || !code) {
      const message = ERROR_TEXT[error ?? ""] ?? "Login failed. Try again.";
      finish(res, error ?? "unknown");
      settle.reject(new LoginError(message));
      return;
    }
    void exchange(code)
      .then((credentials) => {
        finish(res, null);
        settle.resolve(credentials);
      })
      .catch((exchangeError: Error) => {
        finish(res, "exchange_failed");
        settle.reject(exchangeError);
      });
  });

  const exchange = async (code: string): Promise<Credentials> => {
    const res = await fetchFn(`${options.serverUrl}/auth/cli/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier, label: options.label }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      email?: string;
      error?: { message?: string };
    };
    if (!res.ok || !body.token || !body.email) {
      throw new LoginError(body.error?.message ?? `Login failed (${res.status}).`);
    }
    return { token: body.token, email: body.email };
  };

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const params = new URLSearchParams({ port: String(port), state, challenge: s256(verifier) });
  if (options.inviteCode) params.set("invite", options.inviteCode);
  const startUrl = `${options.serverUrl}/auth/cli/start?${params}`;

  const timer = setTimeout(
    () => settle.reject(new LoginError("Login timed out. Try again.")),
    options.timeoutMs ?? LOGIN_TIMEOUT_MS,
  );
  const onAbort = () => settle.reject(new LoginError("Login cancelled."));
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    options.onUrl?.(startUrl);
    // The URL is also shown, so a failed browser open is not fatal
    options.openBrowser(startUrl).catch(() => {});
    return await result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    server.close();
    server.closeAllConnections();
  }
}
