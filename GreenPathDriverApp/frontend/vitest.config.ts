import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    clearMocks: true,
    // The jsdom + React 19 rendering tests on Windows can exceed the 5s
    // default when several files run in parallel.
    testTimeout: 15_000,
  },
});