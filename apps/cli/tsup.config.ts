import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node24",
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
