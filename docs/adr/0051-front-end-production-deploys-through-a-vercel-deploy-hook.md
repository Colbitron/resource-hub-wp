---
status: accepted
date: 2026-11-05
amended: 2026-11-07
---

# The front end's production deploys come from CI through a Vercel deploy hook

The deploy order puts the CMS first and the front end second: the front end goes live only after the CMS it reads has deployed and the `web` job has passed on the same commit. Vercel's Git integration deploys production on every push to `main` by itself, in parallel with CI and with no knowledge of either job, so it has to stop doing that, while pull requests keep their preview deploys. Two decisions follow.

**Git-triggered production deploys are turned off in the repository.** `apps/web/vercel.json` sets `"git": { "deploymentEnabled": { "main": false } }`. Vercel then creates no deployment for a push to `main`, and every other branch still gets a preview. The setting is reviewed in a diff like any other change.

**CI starts the deploy with a fire-and-forget hook.** The `deploy-web` job needs the CMS deploy and the `web` job, and POSTs to the hook whose URL is the secret `VERCEL_DEPLOY_HOOK_URL`. The hook takes no commit and builds whatever `main` points at, so the job first reads `main`'s head and fires only if it is still the commit the run tested. It logs the queued job and does not wait on the build.

## Considered options

- **The dashboard's Ignored Build Step, skipping production builds from Git.** Works whatever hooks do, but lives in project settings, outside review. Kept as the fallback; not needed (see below).
- **Disconnecting the Git repository from the Vercel project.** Rejected: it stops the preview deploys too.
- **`vercel deploy --prod` from CI with a token, or `--prebuilt` after `vercel build`.** Deploys exactly the tested commit and can wait for the result. Rejected for the demo: it needs an account-scoped token, the project and org IDs and a CLI build step, where a hook is one URL that can deploy one project and nothing else. It is the upgrade if deploying the tested commit exactly ever matters more than the smaller credential.
- **Polling Vercel's API after the hook.** Rejected: the same token, plus minutes of runner time per deploy.

## Consequences

- **No front-end rollback from a tag.** A hook always builds `main`, so `deploy-web` does not run on tag dispatches, and the front end is rolled back on Vercel by promoting an earlier deployment. An Instant Rollback pauses every later deploy until someone undoes it.
- **A green CI run means the build was queued**, not that it succeeded; the build's failure is visible only on Vercel.
- A narrow window remains between the head check and Vercel reading `main`, which only a deploy that names the commit would close.
- Rotating the hook means creating a new one, updating the secret and deleting the old one. The procedure, the project settings and the rollback steps are in [`docs/runbooks/deploy.md`](../runbooks/deploy.md).
- The first-deploy check closed on 2026-11-06: the setting is read from `apps/web/vercel.json` and does not block deploy hooks. The evidence is in the [runbook](../runbooks/deploy.md#the-front-end-deploy).

## Amendments

### 2026-11-07: `deploy-web` runs on Depot CI

**What changed.** `deploy-web` runs on Depot CI, because CI moved there (ADR 0053). The single `web` job it needed was split into parallel front-end jobs, so it now needs `deploy` plus every one of them: the checks (lint, typecheck, unit tests, the production build and its fixture-route check), the end-to-end suite, the screenshots and brand images, the Lighthouse shards and the job that merges their medians. `VERCEL_DEPLOY_HOOK_URL` is a Depot CI secret, no longer a GitHub repository secret, because the job that reads it moved with CI.

**What did not.** The hook, the head check before it fires and the rest of this record are unchanged: the front end still deploys only after the CMS, only from `main`, and only when every front-end job has passed on the commit the run tested.
