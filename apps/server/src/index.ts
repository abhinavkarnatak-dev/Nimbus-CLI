import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { jsonLogger } from "./log.js";

const config = loadConfig();
const app = createApp({ config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  jsonLogger("info", "nimbus server listening", { port: info.port });
});

// Finish open streams before exiting
const shutdown = () => {
  jsonLogger("info", "shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
