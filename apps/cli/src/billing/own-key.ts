export const OPENAI_URL = "https://api.openai.com/v1";

export type KeyCheck = { ok: true } | { ok: false; message: string };

export const maskKey = (key: string) => `${key.slice(0, 3)}...${key.slice(-4)}`;

// Free check: can this key use the model? No tokens are spent
export async function verifyOpenAIKey(
  key: string,
  model: string,
  fetchFn: typeof fetch = fetch,
): Promise<KeyCheck> {
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key.trim())) {
    return { ok: false, message: "That does not look like an OpenAI API key (sk-...)." };
  }
  const res = await fetchFn(`${OPENAI_URL}/models/${model}`, {
    headers: { authorization: `Bearer ${key.trim()}` },
  }).catch(() => null);
  if (!res) return { ok: false, message: "Could not reach OpenAI to check the key. Try again." };
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, message: "OpenAI rejected this key." };
  if (res.status === 404 || res.status === 403) {
    return { ok: false, message: `This key cannot use ${model}.` };
  }
  if (res.status === 429) {
    return { ok: false, message: "This key has no credit left on OpenAI." };
  }
  return { ok: false, message: `OpenAI could not check the key (${res.status}).` };
}
