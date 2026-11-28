import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node24",
  sourcemap: true,
  clean: true,
  // The harness ships inside the CLI; its own packages stay separate
  noExternal: ["@nimbus/harness"],
  define: { __NIMBUS_VERSION__: JSON.stringify(version) },
  // Keep node:sqlite and friends as written; plain "sqlite" is not a built-in
  removeNodeProtocol: false,
  banner: { js: "#!/usr/bin/env node" },
});
