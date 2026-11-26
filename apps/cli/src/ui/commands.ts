export interface SlashCommand {
  name: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show commands and shortcuts" },
  { name: "/clear", description: "Start a fresh conversation" },
  { name: "/usage", description: "Show tokens and cost for this session" },
  { name: "/login", description: "Log in with Google, optionally with an invite code" },
  { name: "/logout", description: "Log out on this computer" },
  { name: "/exit", description: "Quit Nimbus" },
];

// "/login CODE" into name and argument, for known commands only
export function parseCommand(text: string): { name: string; arg: string } | null {
  const match = /^(\/[a-z]+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const known = COMMANDS.some((command) => command.name === name);
  if (!known && match[2]) return null;
  return { name, arg: match[2]?.trim() ?? "" };
}

export function matchCommands(value: string): SlashCommand[] {
  if (!value.startsWith("/") || value.includes(" ") || value.includes("\n")) return [];
  return COMMANDS.filter((command) => command.name.startsWith(value.toLowerCase()));
}

export const HELP_TEXT = [
  "**Commands**",
  "",
  ...COMMANDS.map((command) => `- \`${command.name}\` ${command.description}`),
  "",
  "**Shortcuts**",
  "",
  "- `Enter` send, `\\` then `Enter` for a new line (pasting keeps lines too)",
  "- `Esc` stop the current reply, or clear the input",
  "- `Up` / `Down` previous messages",
  "- `Tab` complete a command",
  "- `/login CODE` to join with an invite code",
  "- `Ctrl+C` twice to quit",
].join("\n");
