import { stdin, stdout } from "node:process";

// Read a secret from the terminal, showing dots instead of the text
export function promptSecret(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!stdin.isTTY) {
      resolve(null);
      return;
    }
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const finish = (result: string | null) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      resolve(result);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish(value);
        if (char === "\u0003") return finish(null);
        if (char === "\u007f" || char === "\b") {
          if (value) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (char < " ") continue;
        value += char;
        stdout.write("•");
      }
    };
    stdin.on("data", onData);
  });
}
