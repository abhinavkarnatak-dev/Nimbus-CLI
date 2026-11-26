export interface SlashCommand {
  name: string;
  description: string;
}

export const COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show commands and shortcuts" },
  { name: "/clear", description: "Start a fresh conversation" },
  { name: "/usage", description: "Show tokens and cost for this session" },
  { name: "/login", description: "Log in with Google (or switch account)" },
  { name: "/logout", description: "Log out on this computer" },
  { name: "/exit", description: "Quit Nimbus" },
];

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
  "- `Ctrl+C` twice to quit",
].join("\n");
