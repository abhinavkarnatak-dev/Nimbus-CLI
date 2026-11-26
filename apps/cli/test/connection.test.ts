import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_URL, resolveSetup, routeLabel } from "../src/connection.js";

describe("resolveSetup", () => {
  it("uses the Nimbus server when it is configured", () => {
    const setup = resolveSetup({
      NIMBUS_SERVER_URL: "http://localhost:8787/",
      NIMBUS_TOKEN: "nmb_x",
      OPENAI_API_KEY: "sk",
    });
    expect(setup).toEqual({
      mode: "server",
      serverUrl: "http://localhost:8787",
      envToken: "nmb_x",
    });
    expect(routeLabel(setup)).toBe("server localhost:8787");
  });

  it("goes direct when only an OpenAI key is set", () => {
    const setup = resolveSetup({ OPENAI_API_KEY: "sk" });
    expect(setup).toEqual({ mode: "direct", apiKey: "sk" });
    expect(routeLabel(setup)).toBe("direct to OpenAI");
  });

  it("falls back to the default server when nothing is set", () => {
    expect(resolveSetup({})).toEqual({
      mode: "server",
      serverUrl: DEFAULT_SERVER_URL,
      envToken: undefined,
    });
  });
});
