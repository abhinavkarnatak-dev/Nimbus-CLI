export const DEFAULT_SERVER_URL = "https://nimbus-api-bezy.onrender.com";

export interface Setup {
  serverUrl: string;
  customServer: boolean;
  envToken?: string;
}

// Deployed server unless NIMBUS_SERVER_URL says otherwise
export function resolveSetup(env: NodeJS.ProcessEnv = process.env): Setup {
  const serverUrl = env.NIMBUS_SERVER_URL?.trim().replace(/\/+$/, "");
  return {
    serverUrl: serverUrl || DEFAULT_SERVER_URL,
    customServer: Boolean(serverUrl),
    envToken: env.NIMBUS_TOKEN?.trim() || undefined,
  };
}

// Only shown when it is not the normal Nimbus server
export function routeLabel(setup: Setup): string | undefined {
  return setup.customServer ? `server ${setup.serverUrl.replace(/^https?:\/\//, "")}` : undefined;
}
