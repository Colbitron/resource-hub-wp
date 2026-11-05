---
status: accepted
date: 2026-11-05
---

# The front end's production deploys come from CI through a Vercel deploy hook

The deploy order in the root `CLAUDE.md` (decided 2026-11-04) puts the CMS first and the front end second: the front end goes live only after the CMS it reads has deployed and the `web` job has passed on the same commit. Vercel's Git integration deploys production on every push to `main` by itself, in parallel with CI and with no knowledge of either job, so it has to stop doing that, while pull requests and other branches keep their preview deploys (issue #12). Two decisions follow: how to turn off the Git-triggered production deploys, and how CI starts the one it wants.

## Turning off Git-triggered production deploys: `vercel.json`

`apps/web/vercel.json`, in the project's Root Directory, sets `"git": { "deploymentEnabled": { "main": false } }`. Vercel then creates no deployment for a push to `main`, and every other branch, pull requests included, still gets a preview. The setting is in the repository, so it is reviewed in a diff like any other change and cannot drift from what the record says.

**To verify on the first deploy.** Vercel's documentation does not say whether a Deploy Hook still deploys a branch whose `deploymentEnabled` is `false`. The first run of the new job settles it: if the hook queues a job but no production deployment appears, the setting blocks hooks too. The fallback is to remove the `git` block from `vercel.json` and set an Ignored Build Step in the project's dashboard that skips only Git-triggered production builds: a command that exits 0 (skip) for a production build started by a push and 1 (build) for everything else. Which system variables tell a push-triggered build from a hook-triggered one is not documented either, so they are read from the first hook-triggered build's environment before the command is written. This record is then amended with what was measured.

## Starting the deploy: a fire-and-forget hook from CI

A new job, `deploy-web` in `.github/workflows/ci.yml`, `needs: [ deploy, web ]` and runs on a push to `main` or a manual dispatch from `main`. It sends `POST` to the deploy hook whose URL is the repository secret `VERCEL_DEPLOY_HOOK_URL`, passed through `env:` so it is never written into the script or printed, with `curl --fail --silent --show-error`. An empty secret fails the job by name rather than passing. The hook's answer names a queued job, and the step logs its id and state and ends there: it does not wait on the build. A failed Vercel build leaves the previous production deployment serving, and its result is on Vercel, not in CI. The job has its own concurrency group, `deploy-web-production`, so it never queues behind or holds up the CMS deploy.

A hook takes no commit; Vercel builds whatever `main` points at when the request arrives. CI runs on `main` one at a time (the workflow's `ci-${{ github.ref }}` group), so when this job runs a later merge may already be on `main` with its run still waiting, and firing would ship that commit before its own gate. The job therefore reads `main`'s head through the API first and fires only if it is still the commit the run tested; otherwise it leaves a notice and the newer run deploys, if it passes. A narrow window remains between that check and Vercel reading `main`, which only a deploy that names the commit (below) would close.

## What it costs

- **No front-end rollback from a tag.** The CMS deploy redeploys a tagged commit on a manual dispatch; a hook cannot, because it always builds `main`. `deploy-web` therefore does not run on tag dispatches, and the front end is rolled back on Vercel by promoting an earlier production deployment (Instant Rollback). A CMS rollback and a front-end rollback are two separate actions.
- **A green CI run does not mean the front end deployed.** It means the build was queued. The build's own failure is visible only on Vercel.
- **A failed run that was superseded deploys nothing.** If the newer commit's run fails, production stays at the last commit whose run fired the hook, until the next green run on `main`.

## Considered options

- **The dashboard's Ignored Build Step, skipping production builds from Git.** Works whatever the answer on hooks turns out to be, but lives in project settings, outside review and invisible in the repository. Kept as the fallback above.
- **Disconnecting the Git repository from the Vercel project.** Stops every Git-triggered deploy, and with it the preview deploys for pull requests that issue #12 keeps. Rejected.
- **`vercel deploy --prod` from CI with a `VERCEL_TOKEN`, or `--prebuilt` after `vercel build`.** Deploys exactly the commit CI tested and can wait for the result, which closes the window and the rollback gap above. It needs an account-scoped token in GitHub, the project and org IDs, and a Vercel CLI build step, where a hook is one URL that can deploy one project and nothing else. Rejected for the demo; it is the upgrade if deploying the tested commit exactly ever matters more than the smaller credential.
- **Waiting on the build by polling Vercel's API after the hook.** Would show the build's result in CI, but needs the same token as above and minutes of runner time per deploy. Rejected; the hook is fire-and-forget.

## Consequences

- One new repository secret, `VERCEL_DEPLOY_HOOK_URL`, created in the Vercel project's Git settings as a hook for `main`. Rotating it means creating a new hook, updating the secret and deleting the old hook.
- `apps/web/vercel.json` is the first Vercel configuration in the repository; anything else the project needs from `vercel.json` goes there, beside the `git` block.
- A push to `main` that changes only `apps/web/` still runs the gate and the CMS deploy before the front end ships, which is the price of the order: the front end never goes live ahead of the CMS it reads.
