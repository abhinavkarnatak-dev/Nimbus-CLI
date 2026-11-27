import type { Skill } from "@nimbus/harness";
export interface SlashCommand {
  name: string;
  description: string;
}

// Sent as the user's message on /init; seen by the model
export const INIT_REQUEST = `Create an AGENTS.md file in the root of this project, for coding agents like you. First
explore the project: read the README, package and config files, and look at the folder
layout and a few key source files. Then write AGENTS.md, short and specific to this
project (under about 80 lines), with these sections:
- Overview: what the project is and its main parts, in a few lines.
- Commands: the exact commands to install, run, build, test and lint, taken from the
  project files.
- Layout: the important folders and what lives in each.
- Conventions: code style, naming, patterns and libraries the code already follows.
- Gotchas: anything easy to get wrong, such as generated files, environment variables
  (names only, never values) or required setup.
Only write what you found in the project; do not guess. If AGENTS.md already exists,
read it and improve it instead of replacing what the user wrote.`;

export const COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show commands and shortcuts" },
  { name: "/clear", description: "Start a fresh conversation" },
  { name: "/resume", description: "Open an earlier conversation from this folder" },
  { name: "/init", description: "Write an AGENTS.md that tells Nimbus about this project" },
  { name: "/memory", description: "Show what Nimbus remembers (/memory forget <number>)" },
  { name: "/skills", description: "Show the skills Nimbus can use (run one with /name)" },
  { name: "/todo", description: "Show the checklist for the current task" },
  { name: "/context", description: "Show how full the conversation is and what fills it" },
  { name: "/compact", description: "Shrink the conversation, optionally with a focus" },
  { name: "/usage", description: "Show tokens and cost for this session" },
  { name: "/permissions", description: "Choose when Nimbus asks before edits and commands" },
  { name: "/budget", description: "Set a spending limit for this session (/budget 0.50)" },
  { name: "/login", description: "Log in with Google, optionally with an invite code" },
  { name: "/logout", description: "Log out on this computer" },
  { name: "/key", description: "Add or replace your own OpenAI key (/key remove)" },
  { name: "/use", description: "Pay with Nimbus credit or your own key" },
  { name: "/exit", description: "Quit Nimbus" },
];

// Skills as commands; built-in commands win a clash
export function skillCommands(skills: readonly Skill[]): SlashCommand[] {
  return skills
    .filter((skill) => !COMMANDS.some((command) => command.name === `/${skill.name}`))
    .map((skill) => ({ name: `/${skill.name}`, description: skill.description }));
}

// "/login CODE" into name and argument, for known commands only
export function parseCommand(
  text: string,
  extra: readonly SlashCommand[] = [],
): { name: string; arg: string } | null {
  const match = /^(\/[a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  const known = [...COMMANDS, ...extra].some((command) => command.name === name);
  if (!known && match[2]) return null;
  return { name, arg: match[2]?.trim() ?? "" };
}

export function matchCommands(value: string, extra: readonly SlashCommand[] = []): SlashCommand[] {
  if (!value.startsWith("/") || value.includes(" ") || value.includes("\n")) return [];
  return [...COMMANDS, ...extra].filter((command) => command.name.startsWith(value.toLowerCase()));
}

export const HELP_TEXT = [
  "**Commands**",
  "",
  ...COMMANDS.map((command) => `- \`${command.name}\` ${command.description}`),
  "",
  "**Shortcuts**",
  "",
  "- `Enter` send, `Shift+Enter` or `Ctrl+J` for a new line (`\\` then `Enter` works too, pasting keeps lines)",
  "- `Esc` stop the current reply, or clear the input",
  "- `Ctrl+L` clear the screen, the conversation stays (`/clear` starts a new one)",
  "- `Up` / `Down` previous messages",
  "- `Tab` complete a command",
  "- `/<skill name>` run a skill, with optional text after it (see `/skills`)",
  "- `/login CODE` to join with an invite code",
  "- `Ctrl+C` twice to quit",
].join("\n");
