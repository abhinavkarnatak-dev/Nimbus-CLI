export const DEFAULT_SERVER_URL = "http://localhost:8787";

export type Setup =
  { mode: "server"; serverUrl: string; envToken?: string } | { mode: "direct"; apiKey: string };

// Server unless only an OpenAI key is configured
export function resolveSetup(env: NodeJS.ProcessEnv = process.env): Setup {
  const serverUrl = env.NIMBUS_SERVER_URL?.trim().replace(/\/+$/, "");
  const envToken = env.NIMBUS_TOKEN?.trim() || undefined;
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (serverUrl || !apiKey) {
    return { mode: "server", serverUrl: serverUrl || DEFAULT_SERVER_URL, envToken };
  }
  return { mode: "direct", apiKey };
}

export function routeLabel(setup: Setup): string {
  return setup.mode === "server"
    ? `server ${setup.serverUrl.replace(/^https?:\/\//, "")}`
    : "direct to OpenAI";
}
