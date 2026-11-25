import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  buildSystemPrompt,
  defaultTools,
  detectEnvironment,
  HARNESS_VERSION,
  OpenAIModelClient,
  Session,
} from "@nimbus/harness";

const MODEL = "gpt-6-luna";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const env = detectEnvironment();
const session = new Session({
  client: new OpenAIModelClient({ apiKey }),
  model: MODEL,
  instructions: buildSystemPrompt(
    env,
    defaultTools.map((tool) => tool.name),
  ),
  cwd: env.cwd,
  tools: defaultTools,
});

function shortArgs(args: string): string {
  const flat = args.replace(/\s+/g, " ");
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

const rl = createInterface({ input: stdin, output: stdout });
let running: AbortController | undefined;

rl.on("SIGINT", () => {
  if (running) {
    running.abort();
    return;
  }
  stdout.write("\n");
  process.exit(0);
});

console.log(`nimbus v${HARNESS_VERSION} (${MODEL}) - type /exit to quit, Ctrl+C to stop a reply`);

while (true) {
  const text = (await rl.question("\n> ")).trim();
  if (!text) continue;
  if (text === "/exit") break;

  running = new AbortController();
  let midLine = false;
  for await (const event of session.send(text, running.signal)) {
    if (event.type === "text_delta") {
      stdout.write(event.text);
      midLine = !event.text.endsWith("\n");
      continue;
    }
    if (midLine) stdout.write("\n");
    midLine = false;

    if (event.type === "tool_call_start") {
      stdout.write(`  > ${event.name} ${shortArgs(event.args)}\n`);
    } else if (event.type === "tool_call_end") {
      const mark = event.isError ? "x" : "ok";
      stdout.write(`    ${mark} ${event.summary.split("\n")[0]} (${event.durationMs}ms)\n`);
    } else if (event.type === "turn_complete") {
      const { inputTokens, cachedTokens, outputTokens } = event.usage;
      stdout.write(
        `  [in=${inputTokens} cached=${cachedTokens} out=${outputTokens} $${event.cost.toFixed(6)}]\n`,
      );
    } else if (event.type === "turn_cancelled") {
      stdout.write("  [stopped]\n");
    } else {
      stdout.write(`  [error] ${event.message}\n`);
    }
  }
  running = undefined;
}

rl.close();
console.log(`session cost $${session.cost.toFixed(6)}`);
