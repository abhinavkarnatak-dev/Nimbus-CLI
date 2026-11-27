import { basename } from "node:path";

// .env files meant to be shared
const SAFE_ENV_SUFFIXES = [".example", ".sample", ".template", ".dist", ".defaults"];
const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx"]);
const SECRET_NAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
]);

// Files that usually hold passwords, keys or tokens
export function isSecretPath(path: string): boolean {
  const name = basename(path.replace(/\\/g, "/")).toLowerCase();
  if (name === ".env" || name.startsWith(".env.")) {
    return !SAFE_ENV_SUFFIXES.some((suffix) => name.endsWith(suffix));
  }
  if (SECRET_NAMES.has(name)) return true;
  if (/^(client_secret|service[-_]account).*\.json$/.test(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && SECRET_EXTENSIONS.has(name.slice(dot));
}

// Seen by the model when a secret file is refused
export function secretRefusal(path: string): string {
  return `${path} looks like a secret file (for example passwords, API keys, tokens or private keys), so Nimbus will not read, search or change it. This keeps those values out of the conversation and away from the model provider. Do not try to read it another way, for example with bash, cat or type. If you need a value from it, ask the user for that value, or for a copy with the secrets removed. Example files such as .env.example can be read.`;
}

export function assertNotSecret(path: string, display: string): void {
  if (isSecretPath(path)) throw new Error(secretRefusal(display));
}

// Words in a command that name a secret file
export function mentionsSecret(command: string): boolean {
  return command
    .split(/[\s"'`;&|<>()=,]+/)
    .filter(Boolean)
    .some((token) => isSecretPath(token));
}

// Commands that ask even when the user chose not to be asked
export function alwaysAskReason(command: string): string | null {
  if (mentionsSecret(command)) return "This command touches a secret file.";
  if (/\bgit\s+push\b/i.test(command)) return "This command pushes to a remote git repository.";
  if (/\bgit\s+commit\b/i.test(command)) return "This command creates a git commit.";
  if (/\bgit\s+(pull|merge|rebase)\b/i.test(command)) return "This command changes git history.";
  if (/\b(npm|pnpm|yarn)\s+publish\b/i.test(command)) return "This command publishes a package.";
  return null;
}

// Text that carries a key, token or password
export function looksSecret(text: string): boolean {
  return [
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{4,}/i,
  ].some((pattern) => pattern.test(text));
}
