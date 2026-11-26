// Temporary hard blocks until M6 permissions
const DANGEROUS_RM_TARGETS = new Set([
  "/",
  "/*",
  "~",
  "~/",
  "~/*",
  "*",
  ".",
  "./",
  "./*",
  "..",
  "$HOME",
  "${HOME}",
]);

const RULES: Array<[RegExp, string]> = [
  [/\bgit\s+push\b[^;&|]*\s(--force(-with-lease)?|-f)\b/i, "force push"],
  [/\bgit\s+reset\b[^;&|]*--hard\b/i, "hard reset"],
  [/\bgit\s+clean\b[^;&|]*\s-[a-z]*(fd|df)[a-z]*\b/i, "deletes untracked files with git clean"],
  [/(^|[\s;&|(])(mkfs(\.\w+)?|diskpart|shutdown|reboot|halt|poweroff)\b/i, "disk or power command"],
  [/(^|[\s;&|(])format(\.com)?\s+[a-z]:/i, "formats a drive"],
  [
    /\bRemove-Item\b[^;&|]*-Recurse[^;&|]*\s["']?([a-z]:\\?|\/|~|\$HOME|\$env:USERPROFILE)["']?(\s|$)/i,
    "recursive delete of a drive or home folder",
  ],
  [
    /(^|[\s;&|(])(rd|rmdir|del)\s+[^;&|]*\/s\b[^;&|]*\s[a-z]:\\?(\s|$)/i,
    "recursive delete of a drive",
  ],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
];

function dangerousRm(segment: string): boolean {
  const tokens = segment.trim().split(/\s+/);
  const at = tokens.findIndex((token) => token === "rm");
  if (at === -1) return false;

  const args = tokens.slice(at + 1);
  const flags = args.filter((arg) => arg.startsWith("-"));
  const targets = args
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => arg.replace(/^["']|["']$/g, ""));
  const recursive = flags.some((flag) => flag === "--recursive" || /^-[a-z]*r/i.test(flag));
  const force = flags.some((flag) => flag === "--force" || /^-[a-z]*f/i.test(flag));
  return recursive && force && targets.some((target) => DANGEROUS_RM_TARGETS.has(target));
}

export function blockedReason(command: string): string | undefined {
  if (command.split(/[;&|\n]+/).some(dangerousRm)) {
    return "deletes the root, home or whole current folder";
  }
  return RULES.find(([pattern]) => pattern.test(command))?.[1];
}
