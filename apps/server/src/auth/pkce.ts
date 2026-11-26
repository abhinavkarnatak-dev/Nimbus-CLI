import { createHash } from "node:crypto";

// PKCE S256: base64url of sha256(verifier)
export const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const isBase64Url = (value: string, min: number, max: number) =>
  value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
