import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Deletes the app's fetch Data Cache on disk, `.next/cache/fetch-cache`.
 * Run before every `next build` (the `build` script in `package.json`, which
 * CI, Vercel and the e2e harness all use) and, in the harness, again before
 * `next start`.
 *
 * Before the build, so the probes in `lib/prerender.ts` read the CMS live
 * (ADR 0043). `next build` keeps the directory between builds and Vercel
 * restores it from its build cache, and a stale entry is served to
 * `generateStaticParams` while the render that follows refetches it in the
 * foreground: measured 2026-11-07 with entries aged past the hour and the
 * CMS down, the probes answered from the stale copies and every prerender
 * then failed with `CmsError`, exiting the build. With the directory gone,
 * the probes either read the CMS or fall back to `[]`, and the build passes
 * either way.
 *
 * Before `next start` in the harness, because Next.js keeps a
 * `revalidateTag` mark only in the memory of the process that received it,
 * so a restarted app would serve entries a previous run had already
 * revalidated (e2e/README.md). A test-process artefact: on Vercel the Data
 * Cache and its tags live together.
 *
 * Node rather than `rm -rf`, so the command runs on Windows too.
 */
rmSync(fileURLToPath(new URL("../.next/cache/fetch-cache", import.meta.url)), { recursive: true, force: true });
