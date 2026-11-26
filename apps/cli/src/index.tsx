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
  type SearchFn,
  Session,
  webSearchTool,
} from "@nimbus/harness";
import { render } from "ink";
import open from "open";
import { SwitchableModelClient } from "./auth/client.js";
import { AuthController } from "./auth/controller.js";
import { defaultStore } from "./auth/credentials.js";
import { browserLogin } from "./auth/login.js";
import { defaultSecretStore } from "./auth/secrets.js";
import { BillingController } from "./billing/controller.js";
import { RoutingModelClient } from "./billing/router.js";
import { promptSecret } from "./prompt-secret.js";
import { fileSettings } from "./settings.js";
import { parseArgs } from "./args.js";
import { resolveSetup, routeLabel } from "./connection.js";
import { serverSearch } from "./search.js";
import { App } from "./ui/App.js";
import { formatCost } from "./ui/format.js";

const MODEL = "gpt-6-luna";

const { command, action, inviteCode, folder } = parseArgs(process.argv.slice(2));
if (folder) process.chdir(resolve(folder));

const setup = resolveSetup();
let client: ModelClient;
let auth: AuthController | null = null;
let search: SearchFn | undefined;
let billing: BillingController | null = null;

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
    login: ({ onUrl, signal, inviteCode: code }) =>
      browserLogin({
        serverUrl,
        label: `cli ${hostname()}`,
        inviteCode: code,
        openBrowser: (url) => open(url),
        onUrl,
        signal,
      }),
  });
  const router = new RoutingModelClient(
    switchable,
    (key) => new OpenAIModelClient({ apiKey: key }),
  );
  billing = new BillingController({
    keys: defaultSecretStore("openai-api-key"),
    settings: fileSettings(),
    client: router,
    model: MODEL,
  });
  client = router;
  search = serverSearch(auth);
} else {
  client = new OpenAIModelClient({ apiKey: setup.apiKey });
}

if (command === "login" && !auth) {
  console.log("No login needed: Nimbus is using your own OpenAI key.");
}

if (command === "key" || command === "use") {
  if (!billing) {
    console.log("Not available: Nimbus is using OPENAI_API_KEY from the environment.");
  } else if (command === "key" && action === "set") {
    const key = await promptSecret("Paste your OpenAI API key (it stays on this computer): ");
    if (key) {
      const result = await billing.setKey(key);
      console.log(
        result.ok ? `Saved ${billing.state.keyHint}. Nimbus will use your key.` : result.message,
      );
    }
  } else if (command === "key" && action === "remove") {
    billing.removeKey();
    console.log("Removed your OpenAI key. Nimbus will use Nimbus credit.");
  } else if (command === "key") {
    const { keyHint, route } = billing.state;
    console.log(keyHint ? `Saved key: ${keyHint}` : "No OpenAI key saved. Add one: nimbus key set");
    console.log(`Paying with: ${route === "key" ? "your OpenAI key" : "Nimbus credit"}`);
  } else if (action === "key" || action === "nimbus") {
    const ok = action === "nimbus" || billing.state.hasKey;
    if (ok) billing.use(action);
    console.log(
      ok
        ? `Using ${action === "key" ? "your OpenAI key" : "Nimbus credit"}.`
        : "No OpenAI key saved. Add one: nimbus key set",
    );
  } else {
    console.log("Usage: nimbus use nimbus | nimbus use key");
  }
  process.exit(0);
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

// A NIMBUS_TOKEN has no saved email, ask the server once before drawing the header
if (auth?.state.loggedIn && !auth.state.email) {
  await Promise.race([auth.refreshEmail(), new Promise((done) => setTimeout(done, 4000))]);
}

const shell = detectShell();
const env = detectEnvironment(shell);
// Web search needs the Nimbus server, so it is only offered there
const tools = search ? [...defaultTools, webSearchTool] : defaultTools;
const instructions = buildSystemPrompt(
  env,
  tools.map((tool) => tool.name),
);

const createSession = () =>
  new Session({ client, model: MODEL, instructions, cwd: env.cwd, tools, shell, search });

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
    billing={billing}
    loginOnStart={command === "login"}
    inviteCode={inviteCode}
    onExit={(cost) => {
      totalCost = cost;
    }}
  />,
  { exitOnCtrlC: false },
);

await app.waitUntilExit();
console.log(`\nSession cost ${formatCost(totalCost)}`);
