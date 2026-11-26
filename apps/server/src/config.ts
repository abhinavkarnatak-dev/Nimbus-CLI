export interface ServerConfig {
  port: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  devToken: string;
  maxOutputTokens: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

// Read settings from the environment
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    openaiApiKey: required(env, "OPENAI_API_KEY"),
    openaiBaseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    devToken: required(env, "NIMBUS_DEV_TOKEN"),
    maxOutputTokens: Number(env.NIMBUS_MAX_OUTPUT_TOKENS ?? 16_000),
  };
}
