import { OpenAIModelClient } from "@nimbus/harness";

export interface Connection {
  client: OpenAIModelClient;
  route: string;
}

// Server when configured, else direct to OpenAI
export function connect(env: NodeJS.ProcessEnv = process.env): Connection {
  const serverUrl = env.NIMBUS_SERVER_URL?.trim().replace(/\/+$/, "");
  if (serverUrl) {
    const token = env.NIMBUS_DEV_TOKEN?.trim();
    if (!token) throw new Error("NIMBUS_SERVER_URL is set but NIMBUS_DEV_TOKEN is not.");
    return {
      client: new OpenAIModelClient({ apiKey: token, baseURL: `${serverUrl}/v1` }),
      route: `server ${serverUrl.replace(/^https?:\/\//, "")}`,
    };
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Set NIMBUS_SERVER_URL and NIMBUS_DEV_TOKEN, or OPENAI_API_KEY.");
  }
  return { client: new OpenAIModelClient({ apiKey }), route: "direct to OpenAI" };
}
