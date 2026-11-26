export interface CliArgs {
  command: "login" | "logout" | null;
  inviteCode?: string;
  folder?: string;
}

// nimbus [login|logout] [--code CODE] [folder]
export function parseArgs(args: string[]): CliArgs {
  const rest = [...args];
  const command = rest[0] === "login" || rest[0] === "logout" ? rest[0] : null;
  if (command) rest.shift();
  let inviteCode: string | undefined;
  const codeAt = rest.indexOf("--code");
  if (codeAt >= 0) {
    inviteCode = rest[codeAt + 1];
    rest.splice(codeAt, 2);
  }
  return { command, inviteCode, folder: rest[0] };
}
