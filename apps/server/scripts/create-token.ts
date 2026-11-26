import { databaseOptions } from "../src/config.js";
import { connectDb } from "../src/db/client.js";
import { issueToken } from "../src/db/tokens.js";

const [email, label = "dev"] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error("Usage: pnpm db:token <email> [label]");
  process.exit(1);
}

const { db, close } = connectDb(databaseOptions());
try {
  const { token } = await issueToken(db, email, label);
  console.log(`\nToken for ${email.toLowerCase()} (shown only once):\n\n  ${token}\n`);
  console.log("Put it in .env as NIMBUS_TOKEN. Only its hash is stored.\n");
} finally {
  await close();
}
