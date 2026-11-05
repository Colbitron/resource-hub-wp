import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for server-side modules: *.test.ts and *.test.tsx beside the code or under test/.
// Playwright's end-to-end specs are *.spec.ts under e2e/ and never run here.
export default defineConfig({
  resolve: {
    // Modules that render on the server import `server-only`, which throws
    // outside React Server Components; the tests stand it in with an empty
    // module. Nothing else about the modules changes.
    alias: {
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
      // tsconfig's `@/*`, so app code (the route handler) loads here as it does in Next.js.
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
