import { defineConfig } from "vitest/config";

// Unit tests for server-side modules: *.test.ts beside the code. Playwright's
// end-to-end specs are *.spec.ts under e2e/ and never run here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
