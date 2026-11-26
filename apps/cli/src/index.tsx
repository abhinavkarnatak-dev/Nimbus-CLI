import { resolve } from "node:path";
import {
  buildSystemPrompt,
  defaultTools,
  detectEnvironment,
  detectShell,
  HARNESS_VERSION,
  OpenAIModelClient,
  Session,
} from "@nimbus/harness";
import { render } from "ink";
import { App } from "./ui/App.js";
import { formatCost } from "./ui/format.js";

const MODEL = "gpt-6-luna";

const folder = process.argv[2];
if (folder) process.chdir(resolve(folder));

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const shell = detectShell();
const env = detectEnvironment(shell);
const client = new OpenAIModelClient({ apiKey });
const instructions = buildSystemPrompt(
  env,
  defaultTools.map((tool) => tool.name),
);

const createSession = () =>
  new Session({ client, model: MODEL, instructions, cwd: env.cwd, tools: defaultTools, shell });

let totalCost = 0;
const app = render(
  <App
    createSession={createSession}
    info={{ version: HARNESS_VERSION, model: MODEL, shell: shell.name, cwd: env.cwd }}
    onExit={(cost) => {
      totalCost = cost;
    }}
  />,
  { exitOnCtrlC: false },
);

await app.waitUntilExit();
console.log(`\nSession cost ${formatCost(totalCost)}`);
