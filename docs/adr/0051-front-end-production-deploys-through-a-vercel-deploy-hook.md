---
status: accepted
date: 2026-11-05
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
- The first-deploy check closed on 2026-11-06: the merge of #40 produced exactly one production deployment, created by the hook, so Vercel reads `git.deploymentEnabled` from `apps/web/vercel.json` with the Root Directory set to `apps/web`, and the setting does not block deploy hooks.
