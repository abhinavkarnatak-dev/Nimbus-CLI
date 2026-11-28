import { defineConfig } from "vitest/config";

// Ink renders are slow on the Windows and macOS CI runners
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
