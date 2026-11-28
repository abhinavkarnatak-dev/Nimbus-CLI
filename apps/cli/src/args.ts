export type Command = "login" | "logout" | "key" | "use";

export interface CliArgs {
  command: Command | null;
  // key: set | remove, use: nimbus | key
  action?: string;
  inviteCode?: string;
  folder?: string;
  // --resume opens the list, --continue the latest conversation
  resume?: "pick" | "latest";
  // --version and --help print and exit
  info?: "version" | "help";
}

export const USAGE = `Usage: nimbus [folder]

  nimbus                    Start in the current folder
  nimbus <folder>           Start in another folder
  nimbus --continue         Open the latest conversation in this folder
  nimbus --resume           Pick an earlier conversation
  nimbus login [--code C]   Log in with Google, with an invite code
  nimbus logout             Log out on this computer
  nimbus key [set|remove]   Add or remove your own OpenAI key
  nimbus use nimbus|key     Pay with Nimbus credit or your own key
  nimbus --version          Show the version

Inside Nimbus, type / to see every command.`;

const COMMANDS: Command[] = ["login", "logout", "key", "use"];
const ACTIONS: Partial<Record<Command, string[]>> = {
  key: ["set", "remove"],
  use: ["nimbus", "key"],
};

// nimbus [login|logout|key [set|remove]|use nimbus|key] [--code CODE] [--resume|--continue] [folder]
export function parseArgs(args: string[]): CliArgs {
  if (args.some((arg) => arg === "--version" || arg === "-v")) {
    return { command: null, info: "version" };
  }
  if (args.some((arg) => arg === "--help" || arg === "-h")) return { command: null, info: "help" };
  const rest = [...args];
  const command = COMMANDS.includes(rest[0] as Command) ? (rest.shift() as Command) : null;
  let action: string | undefined;
  if (command && ACTIONS[command]?.includes(rest[0] ?? "")) action = rest.shift();
  let inviteCode: string | undefined;
  const codeAt = rest.indexOf("--code");
  if (codeAt >= 0) {
    inviteCode = rest[codeAt + 1];
    rest.splice(codeAt, 2);
  }
  let resume: CliArgs["resume"];
  for (const [flag, mode] of [
    ["--resume", "pick"],
    ["--continue", "latest"],
  ] as const) {
    const at = rest.indexOf(flag);
    if (at < 0) continue;
    resume = mode;
    rest.splice(at, 1);
  }
  return {
    command,
    ...(action ? { action } : {}),
    inviteCode,
    folder: rest[0],
    ...(resume ? { resume } : {}),
  };
}
