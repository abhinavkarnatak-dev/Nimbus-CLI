import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Route = "nimbus" | "key";

export type PermissionMode = "ask" | "edits" | "full";

export interface Settings {
  use?: Route;
  permissions?: PermissionMode;
}

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
}

// Plain preferences, nothing secret in here
export function fileSettings(path = join(homedir(), ".nimbus", "settings.json")): SettingsStore {
  return {
    load: () => {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as Settings;
      } catch {
        return {};
      }
    },
    save: (settings) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(settings, null, 2));
    },
  };
}

export function memorySettings(initial: Settings = {}): SettingsStore {
  let saved = { ...initial };
  return {
    load: () => ({ ...saved }),
    save: (settings) => {
      saved = { ...settings };
    },
  };
}
