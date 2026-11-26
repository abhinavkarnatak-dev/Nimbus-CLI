import { readFileSync } from "node:fs";

export interface ServerConfig {
  port: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  databaseUrl: string;
  databaseCaCert?: string;
  maxOutputTokens: number;
  publicUrl: string;
  googleClientId: string;
  googleClientSecret: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

// Database URL and optional CA certificate file
export function databaseOptions(env: NodeJS.ProcessEnv = process.env) {
  const caPath = env.DATABASE_CA_CERT_PATH?.trim();
  return {
    url: required(env, "DATABASE_URL"),
    caCert: caPath ? readFileSync(caPath, "utf8") : undefined,
  };
}

// Read settings from the environment
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const database = databaseOptions(env);
  const port = Number(env.PORT ?? 8787);
  return {
    port,
    openaiApiKey: required(env, "OPENAI_API_KEY"),
    openaiBaseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    databaseUrl: database.url,
    databaseCaCert: database.caCert,
    maxOutputTokens: Number(env.NIMBUS_MAX_OUTPUT_TOKENS ?? 16_000),
    // Where browsers reach this server, used for the Google redirect
    publicUrl: (env.NIMBUS_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    googleClientId: required(env, "GOOGLE_CLIENT_ID"),
    googleClientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
  };
}
