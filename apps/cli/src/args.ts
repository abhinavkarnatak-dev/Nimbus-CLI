export type Command = "login" | "logout" | "key" | "use";

export interface CliArgs {
  command: Command | null;
  // key: set | remove, use: nimbus | key
  action?: string;
  inviteCode?: string;
  folder?: string;
}

const COMMANDS: Command[] = ["login", "logout", "key", "use"];
const ACTIONS: Partial<Record<Command, string[]>> = {
  key: ["set", "remove"],
  use: ["nimbus", "key"],
};

// nimbus [login|logout|key [set|remove]|use nimbus|key] [--code CODE] [folder]
export function parseArgs(args: string[]): CliArgs {
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
  return { command, ...(action ? { action } : {}), inviteCode, folder: rest[0] };
}
