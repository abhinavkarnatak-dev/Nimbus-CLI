import { readFileSync } from "node:fs";

export interface ServerConfig {
  port: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  databaseUrl: string;
  databaseCaCert?: string;
  maxOutputTokens: number;
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
  return {
    port: Number(env.PORT ?? 8787),
    openaiApiKey: required(env, "OPENAI_API_KEY"),
    openaiBaseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    databaseUrl: database.url,
    databaseCaCert: database.caCert,
    maxOutputTokens: Number(env.NIMBUS_MAX_OUTPUT_TOKENS ?? 16_000),
  };
}
