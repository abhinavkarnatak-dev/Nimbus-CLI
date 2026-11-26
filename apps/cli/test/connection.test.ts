import { describe, expect, it } from "vitest";
import { connect } from "../src/connection.js";

describe("connect", () => {
  it("prefers the Nimbus server when it is configured", () => {
    const { route } = connect({
      NIMBUS_SERVER_URL: "http://localhost:8787/",
      NIMBUS_DEV_TOKEN: "dev",
      OPENAI_API_KEY: "sk",
    });
    expect(route).toBe("server localhost:8787");
  });

  it("falls back to OpenAI directly", () => {
    expect(connect({ OPENAI_API_KEY: "sk" }).route).toBe("direct to OpenAI");
  });

  it("explains what is missing", () => {
    expect(() => connect({ NIMBUS_SERVER_URL: "http://localhost:8787" })).toThrow(
      "NIMBUS_DEV_TOKEN",
    );
    expect(() => connect({})).toThrow("OPENAI_API_KEY");
  });
});
