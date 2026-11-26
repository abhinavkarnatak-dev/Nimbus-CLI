import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Entry } from "@napi-rs/keyring";

export interface Credentials {
  token: string;
  email: string;
}

export interface CredentialStore {
  readonly kind: "keychain" | "file" | "memory";
  load(): Credentials | null;
  save(credentials: Credentials): void;
  clear(): void;
}

function parse(raw: string | null | undefined): Credentials | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Credentials>;
    return typeof value.token === "string" && typeof value.email === "string"
      ? { token: value.token, email: value.email }
      : null;
  } catch {
    return null;
  }
}

// OS keychain: Credential Manager, Keychain, Secret Service
export function keychainStore(account: string): CredentialStore {
  const entry = new Entry("nimbus", account);
  return {
    kind: "keychain",
    load: () => parse(entry.getPassword()),
    save: (credentials) => entry.setPassword(JSON.stringify(credentials)),
    clear: () => {
      entry.deletePassword();
    },
  };
}

// Fallback for machines without a keychain, readable only by this user
export function fileStore(account: string, path = join(homedir(), ".nimbus", "credentials.json")) {
  const readAll = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const writeAll = (data: Record<string, unknown>) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  const store: CredentialStore = {
    kind: "file",
    load: () => parse(JSON.stringify(readAll()[account] ?? null)),
    save: (credentials) => writeAll({ ...readAll(), [account]: credentials }),
    clear: () => {
      const data = readAll();
      delete data[account];
      writeAll(data);
    },
  };
  return store;
}

export function memoryStore(initial: Credentials | null = null): CredentialStore {
  let saved = initial;
  return {
    kind: "memory",
    load: () => saved,
    save: (credentials) => {
      saved = credentials;
    },
    clear: () => {
      saved = null;
    },
  };
}

// Keychain when it works on this machine, else the file
export function defaultStore(serverUrl: string): CredentialStore {
  const account = new URL(serverUrl).host;
  try {
    const keychain = keychainStore(account);
    keychain.load();
    return keychain;
  } catch {
    return fileStore(account);
  }
}
