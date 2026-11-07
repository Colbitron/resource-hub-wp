import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // A CommonJS config (lighthouserc.cjs, which LHCI loads with require())
  // can only import with require().
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // A local `vercel build` writes the deployment's functions and static
    // files here (gitignored), which are not this app's sources.
    ".vercel/**",
    // The calibration page's snapshot of the app's own build output
    // (e2e/write-calibration-page.mts), minified and never edited by hand.
    "e2e/calibration-page/**",
  ]),
]);

export default eslintConfig;
