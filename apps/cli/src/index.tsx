import { hostname } from "node:os";
import { resolve } from "node:path";
import {
  buildSystemPrompt,
  defaultTools,
  detectEnvironment,
  detectShell,
  HARNESS_VERSION,
  type ModelClient,
  OpenAIModelClient,
  Session,
} from "@nimbus/harness";
import { render } from "ink";
import open from "open";
import { SwitchableModelClient } from "./auth/client.js";
import { AuthController } from "./auth/controller.js";
import { defaultStore } from "./auth/credentials.js";
import { browserLogin } from "./auth/login.js";
import { resolveSetup, routeLabel } from "./connection.js";
import { App } from "./ui/App.js";
import { formatCost } from "./ui/format.js";

const MODEL = "gpt-6-luna";

const args = process.argv.slice(2);
const command = args[0] === "login" || args[0] === "logout" ? args[0] : null;
const folder = command ? args[1] : args[0];
if (folder) process.chdir(resolve(folder));

const setup = resolveSetup();
let client: ModelClient;
let auth: AuthController | null = null;

if (setup.mode === "server") {
  const { serverUrl } = setup;
  const switchable = new SwitchableModelClient(
    (token) => new OpenAIModelClient({ apiKey: token, baseURL: `${serverUrl}/v1` }),
  );
  auth = new AuthController({
    serverUrl,
    store: defaultStore(serverUrl),
    client: switchable,
    envToken: setup.envToken,
    login: ({ onUrl, signal }) =>
      browserLogin({
        serverUrl,
        label: `cli ${hostname()}`,
        openBrowser: (url) => open(url),
        onUrl,
        signal,
      }),
  });
  client = switchable;
} else {
  client = new OpenAIModelClient({ apiKey: setup.apiKey });
}

if (command === "login" && !auth) {
  console.log("No login needed: Nimbus is using your own OpenAI key.");
}

if (command === "logout") {
  if (auth?.state.loggedIn) {
    await auth.logout();
    console.log("Logged out on this computer.");
  } else {
    console.log("Not logged in.");
  }
  process.exit(0);
}

const shell = detectShell();
const env = detectEnvironment(shell);
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
    info={{
      version: HARNESS_VERSION,
      model: MODEL,
      shell: shell.name,
      cwd: env.cwd,
      route: routeLabel(setup),
    }}
    auth={auth}
    loginOnStart={command === "login"}
    onExit={(cost) => {
      totalCost = cost;
    }}
  />,
  { exitOnCtrlC: false },
);

await app.waitUntilExit();
console.log(`\nSession cost ${formatCost(totalCost)}`);
