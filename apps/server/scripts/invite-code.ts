import { databaseOptions } from "../src/config.js";
import { connectDb } from "../src/db/client.js";
import { createInviteCode, normalizeCode } from "../src/db/invites.js";

// pnpm db:invite-code <CODE> --uses <n> [--days <n>]
const args = process.argv.slice(2);
const code = args[0];
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : undefined;
};
const uses = option("--uses");
const days = option("--days");
const validCode = code !== undefined && /^[A-Za-z0-9_-]{3,64}$/.test(code);
if (!validCode || !uses || uses < 1 || (days !== undefined && !(days > 0))) {
  console.error("Usage: pnpm db:invite-code <CODE> --uses <n> [--days <n>]");
  process.exit(1);
}

const { db, close } = connectDb(databaseOptions());
try {
  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : undefined;
  await createInviteCode(db, code, uses, expiresAt);
  const until = expiresAt ? `, valid until ${expiresAt.toISOString().slice(0, 10)}` : "";
  console.log(`Code ${normalizeCode(code)}: ${uses} uses${until}.`);
  console.log(`Share: nimbus login --code ${normalizeCode(code)}`);
} finally {
  await close();
}
