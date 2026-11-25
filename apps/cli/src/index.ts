import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  buildSystemPrompt,
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

const session = new Session({
  client: new OpenAIModelClient({ apiKey }),
  model: MODEL,
  instructions: buildSystemPrompt(detectEnvironment()),
});

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
  for await (const event of session.send(text, running.signal)) {
    if (event.type === "text_delta") {
      stdout.write(event.text);
    } else if (event.type === "turn_complete") {
      const { inputTokens, cachedTokens, outputTokens } = event.usage;
      stdout.write(
        `\n  [in=${inputTokens} cached=${cachedTokens} out=${outputTokens} $${event.cost.toFixed(6)}]\n`,
      );
    } else if (event.type === "turn_cancelled") {
      stdout.write("\n  [stopped]\n");
    } else {
      stdout.write(`\n  [error] ${event.message}\n`);
    }
  }
  running = undefined;
}

rl.close();
console.log(`session cost $${session.cost.toFixed(6)}`);
