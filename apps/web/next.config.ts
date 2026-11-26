import { resolve } from "node:path";
import type { NextConfig } from "next";

// Monorepo root, so Next does not guess it from lockfiles
const root = resolve(process.cwd(), "../..");

const config: NextConfig = {
  output: "export",
  reactStrictMode: true,
  // Commands list comes straight from the CLI source
  transpilePackages: ["@nimbus/cli"],
  images: { unoptimized: true },
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
