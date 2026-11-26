import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeModelClient, type ModelEvent } from "@nimbus/harness";
import { describe, expect, it } from "vitest";
import { fileSecret, memorySecret } from "../src/auth/secrets.js";
import { BillingController } from "../src/billing/controller.js";
import { maskKey, verifyOpenAIKey } from "../src/billing/own-key.js";
import { RoutingModelClient } from "../src/billing/router.js";
import { memorySettings } from "../src/settings.js";

const KEY = "sk-test_aaaaaaaaaaaaaaaaaaaaaaaa1b2c";
const statusFetch = (status: number) =>
  (async () => new Response("{}", { status })) as unknown as typeof fetch;

async function texts(client: RoutingModelClient): Promise<string> {
  let out = "";
  for await (const event of client.stream({ model: "m", instructions: "", input: [] })) {
    if ((event as ModelEvent).type === "text_delta") out += (event as { text: string }).text;
  }
  return out;
}

describe("verifyOpenAIKey", () => {
  it("accepts a key that can use the model", async () => {
    expect(await verifyOpenAIKey(KEY, "gpt-6-luna", statusFetch(200))).toEqual({ ok: true });
  });

  it("explains every way a key can fail", async () => {
    const message = async (key: string, fetchFn: typeof fetch) => {
      const result = await verifyOpenAIKey(key, "gpt-6-luna", fetchFn);
      return result.ok ? "" : result.message;
    };
    expect(await message("hello", statusFetch(200))).toContain("does not look like");
    expect(await message(KEY, statusFetch(401))).toContain("rejected");
    expect(await message(KEY, statusFetch(404))).toContain("cannot use gpt-6-luna");
    expect(await message(KEY, statusFetch(429))).toContain("no credit");
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await message(KEY, offline)).toContain("Could not reach OpenAI");
  });

  it("shows only the start and the last 4 characters", () => {
    expect(maskKey(KEY)).toBe("sk-...1b2c");
  });
});

describe("RoutingModelClient", () => {
  it("sends calls to Nimbus or to the user's key", async () => {
    const router = new RoutingModelClient(
      new FakeModelClient([{ text: "from nimbus" }]),
      () => new FakeModelClient([{ text: "from key" }]),
    );
    expect(await texts(router)).toBe("from nimbus");
    router.setKey(KEY);
    router.route = "key";
    expect(await texts(router)).toBe("from key");
  });
});

describe("BillingController", () => {
  const make = (saved: string | null = null, use?: "nimbus" | "key", status = 200) => {
    const router = new RoutingModelClient(new FakeModelClient([]), () => new FakeModelClient([]));
    const keys = memorySecret(saved);
    const settings = memorySettings(use ? { use } : {});
    const billing = new BillingController({
      keys,
      settings,
      client: router,
      model: "gpt-6-luna",
      fetchFn: statusFetch(status),
    });
    return { billing, keys, settings, router };
  };

  it("starts on the saved choice only when a key exists", () => {
    expect(make(KEY, "key").billing.state).toEqual({
      route: "key",
      hasKey: true,
      keyHint: "sk-...1b2c",
    });
    expect(make(null, "key").billing.state.route).toBe("nimbus");
  });

  it("saves a good key and switches to it", async () => {
    const { billing, keys, settings } = make();
    expect(await billing.setKey(` ${KEY} `)).toEqual({ ok: true });
    expect(keys.load()).toBe(KEY);
    expect(billing.state.route).toBe("key");
    expect(settings.load().use).toBe("key");
  });

  it("keeps the old key when a new one is rejected", async () => {
    const { billing, keys } = make(KEY, "key", 401);
    const result = await billing.setKey("sk-other_bbbbbbbbbbbbbbbbbbbbbbbb9999");
    expect(result.ok).toBe(false);
    expect(keys.load()).toBe(KEY);
    expect(billing.state.route).toBe("key");
  });

  it("goes back to Nimbus credit when the key is removed", () => {
    const { billing, keys } = make(KEY, "key");
    billing.removeKey();
    expect(keys.load()).toBeNull();
    expect(billing.state).toEqual({ route: "nimbus", hasKey: false, keyHint: null });
  });

  it("will not switch to a key that does not exist", () => {
    const { billing } = make();
    expect(billing.use("key")).toBe(false);
    expect(billing.state.route).toBe("nimbus");
  });
});

describe("fileSecret", () => {
  it("saves, loads and clears, readable only by the user", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "nimbus-secret-")), "secrets.json");
    const store = fileSecret("openai-api-key", path);
    store.save(KEY);
    expect(store.load()).toBe(KEY);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    store.clear();
    expect(store.load()).toBeNull();
  });
});
