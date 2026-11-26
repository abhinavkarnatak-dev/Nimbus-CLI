import { createHash } from "node:crypto";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelClient } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { SwitchableModelClient } from "../src/auth/client.js";
import { AuthController } from "../src/auth/controller.js";
import { fileStore, memoryStore } from "../src/auth/credentials.js";
import { browserLogin, LoginError } from "../src/auth/login.js";

const s256 = (value: string) => createHash("sha256").update(value).digest("base64url");

// Plays the server: checks PKCE and hands out a token
function fakeExchange() {
  const seen: { code: string; verifier: string; label: string }[] = [];
  let challenge = "";
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      code: string;
      verifier: string;
      label: string;
    };
    seen.push(body);
    if (s256(body.verifier) !== challenge) {
      return Response.json({ error: { message: "bad verifier" } }, { status: 400 });
    }
    return Response.json({ token: "nmb_test", email: "me@gmail.com" });
  }) as typeof fetch;
  return { fetchFn, seen, setChallenge: (value: string) => (challenge = value) };
}

// Plays the browser: follows the start URL straight back to the CLI
function fakeBrowser(exchange: ReturnType<typeof fakeExchange>, params: Record<string, string>) {
  return async (startUrl: string) => {
    const url = new URL(startUrl);
    exchange.setChallenge(url.searchParams.get("challenge")!);
    const back = new URL(`http://127.0.0.1:${url.searchParams.get("port")}/callback`);
    back.searchParams.set("state", url.searchParams.get("state")!);
    for (const [key, value] of Object.entries(params)) back.searchParams.set(key, value);
    const res = await fetch(back);
    return res.text();
  };
}

describe("browserLogin", () => {
  it("gets a token through the local callback and PKCE", async () => {
    const exchange = fakeExchange();
    let shownUrl = "";
    const credentials = await browserLogin({
      serverUrl: "http://server.test",
      label: "cli test",
      fetchFn: exchange.fetchFn,
      openBrowser: fakeBrowser(exchange, { code: "one-time" }),
      onUrl: (url) => (shownUrl = url),
    });
    expect(credentials).toEqual({ token: "nmb_test", email: "me@gmail.com" });
    expect(shownUrl).toMatch(
      /^http:\/\/server\.test\/auth\/cli\/start\?port=\d+&state=.+&challenge=.+/,
    );
    expect(exchange.seen[0]).toMatchObject({ code: "one-time", label: "cli test" });
  });

  it("explains errors sent back by the server", async () => {
    const exchange = fakeExchange();
    await expect(
      browserLogin({
        serverUrl: "http://server.test",
        label: "x",
        fetchFn: exchange.fetchFn,
        openBrowser: fakeBrowser(exchange, { error: "access_denied" }),
      }),
    ).rejects.toThrow("Login was cancelled in the browser.");
  });

  it("ignores callbacks with the wrong state and can be cancelled", async () => {
    const exchange = fakeExchange();
    const abort = new AbortController();
    const login = browserLogin({
      serverUrl: "http://server.test",
      label: "x",
      fetchFn: exchange.fetchFn,
      signal: abort.signal,
      openBrowser: async (startUrl) => {
        const port = new URL(startUrl).searchParams.get("port");
        const res = await fetch(`http://127.0.0.1:${port}/callback?state=wrong&code=x`);
        expect(res.status).toBe(404);
        abort.abort();
      },
    });
    await expect(login).rejects.toBeInstanceOf(LoginError);
    expect(exchange.seen).toHaveLength(0);
  });

  it("times out when the browser never comes back", async () => {
    await expect(
      browserLogin({
        serverUrl: "http://server.test",
        label: "x",
        timeoutMs: 50,
        openBrowser: async () => {},
      }),
    ).rejects.toThrow("timed out");
  });
});

describe("AuthController", () => {
  const make = (options: { envToken?: string; saved?: { token: string; email: string } } = {}) => {
    const client = new SwitchableModelClient(() => new FakeModelClient([{ text: "ok" }]));
    const store = memoryStore(options.saved ?? null);
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return url.endsWith("/v1/me")
        ? Response.json({ email: "env@gmail.com" })
        : new Response(null, { status: 204 });
    }) as typeof fetch;
    const auth = new AuthController({
      serverUrl: "http://server.test",
      store,
      client,
      envToken: options.envToken,
      fetchFn,
      login: async () => ({ token: "nmb_new", email: "new@gmail.com" }),
    });
    return { auth, client, store, calls };
  };

  it("prefers NIMBUS_TOKEN, then the saved login", async () => {
    const fromEnv = make({
      envToken: "nmb_env",
      saved: { token: "nmb_saved", email: "s@gmail.com" },
    });
    expect(fromEnv.auth.state).toEqual({ loggedIn: true, email: null });
    expect(await fromEnv.auth.refreshEmail()).toBe("env@gmail.com");

    const saved = make({ saved: { token: "nmb_saved", email: "s@gmail.com" } });
    expect(saved.auth.state).toEqual({ loggedIn: true, email: "s@gmail.com" });
    expect(saved.client.hasToken).toBe(true);

    const none = make();
    expect(none.auth.state.loggedIn).toBe(false);
    expect(none.client.hasToken).toBe(false);
  });

  it("saves the login and switches the client token", async () => {
    const { auth, client, store } = make();
    const email = await auth.login({ onUrl: () => {}, signal: new AbortController().signal });
    expect(email).toBe("new@gmail.com");
    expect(store.load()).toEqual({ token: "nmb_new", email: "new@gmail.com" });
    expect(client.hasToken).toBe(true);
  });

  it("revokes on the server and forgets locally on logout", async () => {
    const { auth, store, calls } = make({ saved: { token: "nmb_saved", email: "s@gmail.com" } });
    await auth.logout();
    expect(calls).toContain("http://server.test/v1/auth/logout");
    expect(store.load()).toBeNull();
    expect(auth.state.loggedIn).toBe(false);
  });
});

describe("credentials", () => {
  it("refuses to stream without a token, with a 401 status", async () => {
    const client = new SwitchableModelClient(() => new FakeModelClient([]));
    const stream = client.stream({ model: "m", instructions: "", input: [] });
    await expect(stream.next()).rejects.toMatchObject({ status: 401 });
  });

  it("file store keeps logins per server, readable only by the user", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "nimbus-cred-")), "credentials.json");
    const a = fileStore("a.test", path);
    const b = fileStore("b.test", path);
    a.save({ token: "nmb_a", email: "a@gmail.com" });
    b.save({ token: "nmb_b", email: "b@gmail.com" });
    expect(a.load()?.token).toBe("nmb_a");
    a.clear();
    expect(a.load()).toBeNull();
    expect(b.load()?.token).toBe("nmb_b");
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });
});
