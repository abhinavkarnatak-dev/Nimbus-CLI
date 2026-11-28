// The website imports this file: no imports from the harness here

export interface SlashCommand {
  name: string;
  description: string;
}

// Sent as the user's message on /init; seen by the model
export const INIT_REQUEST = `Create an AGENTS.md file in the root of this project, for AI agents like you. First
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

// Sent as the user's message on /commit; seen by the model
export const COMMIT_REQUEST = `Write a commit message for the user's staged changes and commit them.

1. Run git status and git diff --staged to see what is staged. If nothing is staged, stop
   and tell the user to stage the files they want first (for example with git add). Never
   stage, unstage or change files yourself.
2. Read the staged diff carefully. If it is large, start with git diff --staged --stat to
   see which files changed, then read the important parts.
3. Look at the last few commits with git log --oneline -10 and follow their style if the
   project has one.
4. Write one commit message in the form type(scope): message
   - type is one of feat, fix, refactor, docs, test, perf, style, build or chore.
   - scope is the main part of the project that changed, in one or two words.
   - message says what changed in plain words, in under about 72 characters.
   - If the change needs more explanation, add a short body after a blank line: what
     changed and why, not how.
5. Commit with git commit -m "<message>" (and a second -m for the body). Do not add
   co-author lines, sign-offs or any other trailers, and never use --amend or --no-verify.
6. Never push. After the commit, show the user the commit hash and message.`;

const ADDED = "\n\nThe user added: ";

// "/commit text": the request plus what the user typed
export function commitRequest(arg: string): string {
  return arg.trim() ? `${COMMIT_REQUEST}${ADDED}${arg.trim()}` : COMMIT_REQUEST;
}

// What the user typed, for showing a saved request again
export function parseCommitRequest(text: string): string | null {
  if (text === COMMIT_REQUEST) return "/commit";
  if (!text.startsWith(COMMIT_REQUEST + ADDED)) return null;
  return `/commit ${text.slice(COMMIT_REQUEST.length + ADDED.length)}`;
}

export const COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show commands and shortcuts" },
  { name: "/clear", description: "Start a fresh conversation" },
  { name: "/resume", description: "Open an earlier conversation from this folder" },
  { name: "/rename", description: "Give this conversation your own name (/rename <name>)" },
  { name: "/init", description: "Write an AGENTS.md that tells Nimbus about this project" },
  { name: "/commit", description: "Write a commit message for the staged changes and commit" },
  { name: "/memory", description: "Show what Nimbus remembers (/memory forget <number>)" },
  { name: "/skills", description: "Show the skills Nimbus can use (run one with /name)" },
  { name: "/todo", description: "Show the checklist for the current task" },
  { name: "/context", description: "Show how full the conversation is and what fills it" },
  { name: "/compact", description: "Shrink the conversation, optionally with a focus" },
  { name: "/usage", description: "Show tokens and cost for this session" },
  { name: "/trace", description: "Show each model call of the last reply (/trace 3 for reply 3)" },
  { name: "/model", description: "Choose the model and how much it thinks" },
  { name: "/permissions", description: "Choose when Nimbus asks before edits and commands" },
  { name: "/budget", description: "Set a spending limit for this session (/budget 0.50)" },
  { name: "/login", description: "Log in with Google, optionally with an invite code" },
  { name: "/logout", description: "Log out on this computer" },
  { name: "/key", description: "Add or replace your own OpenAI key (/key remove)" },
  { name: "/use", description: "Pay with Nimbus credit or your own key" },
  { name: "/exit", description: "Quit Nimbus" },
];

// Skills as commands; built-in commands win a clash
export function skillCommands(
  skills: readonly { name: string; description: string }[],
): SlashCommand[] {
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
  "- `Shift+Tab` switch the permission mode: ask, auto edits, don't ask (shown in the status bar)",
  "- `/<skill name>` run a skill, with optional text after it (see `/skills`)",
  "- `/login CODE` to join with an invite code",
  "- `Ctrl+C` twice to quit",
].join("\n");
