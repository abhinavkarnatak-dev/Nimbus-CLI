import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_URL, resolveSetup, routeLabel } from "../src/connection.js";

describe("resolveSetup", () => {
  it("uses a custom server when it is configured", () => {
    const setup = resolveSetup({
      NIMBUS_SERVER_URL: "http://localhost:8787/",
      NIMBUS_TOKEN: "nmb_x",
    });
    expect(setup).toEqual({
      serverUrl: "http://localhost:8787",
      customServer: true,
      envToken: "nmb_x",
    });
    expect(routeLabel(setup)).toBe("server localhost:8787");
  });

  it("falls back to the default server and hides the route from users", () => {
    const setup = resolveSetup({});
    expect(setup).toEqual({
      serverUrl: DEFAULT_SERVER_URL,
      customServer: false,
      envToken: undefined,
    });
    expect(routeLabel(setup)).toBeUndefined();
  });

  it("ignores OPENAI_API_KEY from the environment", () => {
    expect(resolveSetup({ OPENAI_API_KEY: "sk-test" })).toEqual(resolveSetup({}));
  });
});
