export const DEFAULT_SERVER_URL = "http://localhost:8787";

export type Setup =
  | { mode: "server"; serverUrl: string; customServer: boolean; envToken?: string }
  | { mode: "direct"; apiKey: string };

// Server unless only an OpenAI key is configured
export function resolveSetup(env: NodeJS.ProcessEnv = process.env): Setup {
  const serverUrl = env.NIMBUS_SERVER_URL?.trim().replace(/\/+$/, "");
  const envToken = env.NIMBUS_TOKEN?.trim() || undefined;
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (serverUrl || !apiKey) {
    return {
      mode: "server",
      serverUrl: serverUrl || DEFAULT_SERVER_URL,
      customServer: Boolean(serverUrl),
      envToken,
    };
  }
  return { mode: "direct", apiKey };
}

// Only shown when it is not the normal Nimbus server
export function routeLabel(setup: Setup): string | undefined {
  if (setup.mode === "direct") return "your OpenAI key";
  return setup.customServer ? `server ${setup.serverUrl.replace(/^https?:\/\//, "")}` : undefined;
}
