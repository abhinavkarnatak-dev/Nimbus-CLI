import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Entry } from "@napi-rs/keyring";

// One secret string, like the user's OpenAI key
export interface SecretStore {
  load(): string | null;
  save(value: string): void;
  clear(): void;
}

export function keychainSecret(account: string): SecretStore {
  const entry = new Entry("nimbus", account);
  return {
    load: () => entry.getPassword() || null,
    save: (value) => entry.setPassword(value),
    clear: () => {
      entry.deletePassword();
    },
  };
}

// Fallback without a keychain, readable only by this user
export function fileSecret(account: string, path = join(homedir(), ".nimbus", "secrets.json")) {
  const readAll = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const writeAll = (data: Record<string, string>) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  const store: SecretStore = {
    load: () => readAll()[account] ?? null,
    save: (value) => writeAll({ ...readAll(), [account]: value }),
    clear: () => {
      const data = readAll();
      delete data[account];
      writeAll(data);
    },
  };
  return store;
}

export function memorySecret(initial: string | null = null): SecretStore {
  let value = initial;
  return {
    load: () => value,
    save: (next) => {
      value = next;
    },
    clear: () => {
      value = null;
    },
  };
}

export function defaultSecretStore(account: string): SecretStore {
  try {
    const keychain = keychainSecret(account);
    keychain.load();
    return keychain;
  } catch {
    return fileSecret(account);
  }
}
