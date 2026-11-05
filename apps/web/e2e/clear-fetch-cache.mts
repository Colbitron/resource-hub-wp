import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Deletes the app's fetch Data Cache on disk, `.next/cache/fetch-cache`,
 * before `next start` in the Playwright web server command. Next.js keeps
 * fetch entries there across processes, but a `revalidateTag` mark lives
 * only in the memory of the process that received it, so a restarted app
 * would serve entries a previous run had already revalidated. A test-process
 * artefact: on Vercel the Data Cache and its tags live together. Node rather
 * than `rm -rf`, so the command runs on Windows too.
 */
rmSync(fileURLToPath(new URL("../.next/cache/fetch-cache", import.meta.url)), { recursive: true, force: true });
