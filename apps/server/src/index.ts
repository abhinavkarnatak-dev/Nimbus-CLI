import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { googleAuth } from "./auth/google.js";
import { loadConfig } from "./config.js";
import { connectDb, sslFor } from "./db/client.js";
import { jsonLogger } from "./log.js";

const config = loadConfig();
const dbOptions = { url: config.databaseUrl, caCert: config.databaseCaCert };
const { db, migrate, close } = connectDb(dbOptions);
const ssl = sslFor(dbOptions);
if (typeof ssl === "object" && !ssl.rejectUnauthorized) {
  jsonLogger("warn", "database TLS is encrypted but the certificate is not checked", {
    fix: "set DATABASE_CA_CERT_PATH to the Supabase CA certificate",
  });
}
const google = googleAuth(
  config.googleClientId,
  config.googleClientSecret,
  `${config.publicUrl}/auth/google/callback`,
);
// Tables first, so new code never runs against an old schema
if (config.migrateOnStart) {
  try {
    await migrate();
    jsonLogger("info", "migrations up to date");
  } catch (error) {
    jsonLogger("error", "migrations failed, not starting", { error: (error as Error).message });
    process.exit(1);
  }
}

const app = createApp({ config, db, google, siteUrl: config.siteUrl });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  jsonLogger("info", "nimbus server listening", { port: info.port });
});

// Finish open streams, then close the pool
const shutdown = () => {
  jsonLogger("info", "shutting down");
  server.close(() => {
    void close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
