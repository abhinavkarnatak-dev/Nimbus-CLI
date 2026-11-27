import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import {
  buildSystemPrompt,
  defaultTools,
  detectEnvironment,
  detectShell,
  HARNESS_VERSION,
  OpenAIModelClient,
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
import { openSessionStore, type SqliteSessionStore } from "./store/sqlite.js";
import { App } from "./ui/App.js";

const MODEL = "gpt-6-luna";

const { command, action, inviteCode, folder } = parseArgs(process.argv.slice(2));
if (folder) process.chdir(resolve(folder));

const setup = resolveSetup();
const { serverUrl } = setup;
const switchable = new SwitchableModelClient(
  (token) => new OpenAIModelClient({ apiKey: token, baseURL: `${serverUrl}/v1` }),
);
const auth = new AuthController({
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
const client = new RoutingModelClient(switchable, (key) => new OpenAIModelClient({ apiKey: key }));
const billing = new BillingController({
  keys: defaultSecretStore("openai-api-key"),
  settings: fileSettings(),
  client,
  model: MODEL,
});
const search = serverSearch(auth);

if (command === "key" || command === "use") {
  if (command === "key" && action === "set") {
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
  if (auth.state.loggedIn) {
    await auth.logout();
    console.log("Logged out on this computer.");
  } else {
    console.log("Not logged in.");
  }
  process.exit(0);
}

// A NIMBUS_TOKEN has no saved email, ask the server once before drawing the header
if (auth.state.loggedIn && !auth.state.email) {
  await Promise.race([auth.refreshEmail(), new Promise((done) => setTimeout(done, 4000))]);
}

const shell = detectShell();
const env = detectEnvironment(shell);
const tools = [...defaultTools, webSearchTool];
const instructions = buildSystemPrompt(
  env,
  tools.map((tool) => tool.name),
);

// Sessions are saved locally; Nimbus still works if the file cannot be opened
let sessionStore: SqliteSessionStore | undefined;
try {
  sessionStore = openSessionStore(join(homedir(), ".nimbus", "nimbus.db"));
} catch (error) {
  console.error(`Sessions will not be saved: ${(error as Error).message}`);
}

const createSession = () =>
  new Session({
    client,
    model: MODEL,
    instructions,
    cwd: env.cwd,
    tools,
    shell,
    search,
    store: sessionStore,
  });

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
  />,
  {
    exitOnCtrlC: false,
    // Lets terminals that support it report Shift+Enter
    kittyKeyboard: { mode: "auto" },
  },
);

await app.waitUntilExit();
sessionStore?.close();
