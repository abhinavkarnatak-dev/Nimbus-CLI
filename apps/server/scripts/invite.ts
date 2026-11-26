import { databaseOptions, usdToMicro } from "../src/config.js";
import { connectDb } from "../src/db/client.js";
import { addInvite } from "../src/db/invites.js";

// pnpm db:invite <email> [--quota <usd>]
const args = process.argv.slice(2);
const email = args[0];
const quotaIndex = args.indexOf("--quota");
const quotaUsd = quotaIndex >= 0 ? Number(args[quotaIndex + 1]) : undefined;
if (!email?.includes("@") || (quotaUsd !== undefined && !(quotaUsd >= 0))) {
  console.error("Usage: pnpm db:invite <email> [--quota <usd>]");
  process.exit(1);
}

const { db, close } = connectDb(databaseOptions());
try {
  await addInvite(db, email, quotaUsd === undefined ? undefined : usdToMicro(quotaUsd));
  const quota = quotaUsd === undefined ? "default trial quota" : `$${quotaUsd} quota`;
  console.log(`Invited ${email.toLowerCase()} (${quota}). They can now run: nimbus login`);
} finally {
  await close();
}
