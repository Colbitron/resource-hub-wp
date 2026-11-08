# Deploying, rolling back and rotating secrets

For the maintainer deploying the CMS or the front end, rolling either back, or rotating a secret. The decisions are [ADR 0005](../adr/0005-hosted-wordpress-on-cloudways.md) (the host), [ADR 0051](../adr/0051-front-end-production-deploys-through-a-vercel-deploy-hook.md) (the front-end deploy) and [ADR 0053](../adr/0053-ci-runs-on-depot-ci.md) (CI on Depot CI); the workflow is `.depot/workflows/ci.yml`, run by Depot CI, whose comments explain each step. A run's state, logs, job summaries and artifacts are read with `depot ci status <run-id>`, `depot ci logs <attempt-id>`, `depot ci summary` and `depot ci artifacts list <run-id>`, or in Depot's dashboard.

## How a deploy happens

Nothing is deployed by hand. A push to `main` runs the gate on Depot CI, then the `deploy` job syncs the plugin to the Cloudways host, then the `deploy-web` job starts the front end's Vercel production build. The CMS goes first and the front end second, so the front end never goes live ahead of the CMS it reads; additive contract changes make that order safe. The CMS deploy needs only the CMS gate, so a front-end failure never blocks a CMS deploy or a rollback. Pull requests and other branches never deploy; pull requests get Vercel preview deploys.

## Which jobs a pull request runs

A push to `main` and every dispatch, on `main` or a tag, run every job; only a pull request is scoped. Its first job, **Scope: the jobs this change needs**, diffs the merge commit Depot checks out against the base (`.depot/scripts/ci-scope.mjs`, whose tests run in the same job) and decides from the changed paths, renames counted at both ends:

| The pull request changes | Runs | About |
|---|---|---|
| only `wp-content/` (and inert paths) | the plugin's gate | 3.1 sandbox-minutes |
| only `apps/` (and inert paths) | the front-end jobs | 3.6 |
| `packages/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.wp-env.json`, `.depot/`, `.gitignore`, any other path, or both `wp-content/` and `apps/` | the plugin's gate and the front-end jobs | 6.9 |
| only inert paths: `docs/`, `.claude/`, `.github/`, `tools/`, a Markdown file at the root | nothing but the scope job and `CI result` | 0.1 |

**No pull request runs Lighthouse**, whatever it changes: the five `web-lighthouse` shards and `web-lighthouse-medians` show as skipped on every pull request and run on every push to `main` and every dispatch, which take about 17.9 sandbox-minutes with them ("CI cost", below). So a broken Lighthouse harness, unlike every other failure, first shows up on `main`, where it holds `deploy-web` back until a fix lands; the CMS deploy still goes ahead. In their place, before pushing a pull request that changes `apps/` (other than Markdown) or `packages/ui/`, the author runs `pnpm web:test:lighthouse:quick` and reads the medians, as part of the local gate before the push: a smell test on the author's machine, not a gate, with the full five-run `pnpm web:test:lighthouse` for a big change (`apps/web/e2e/README.md`, "Lighthouse CI"). `main`'s five-run medians are the measurement of record.

A skipped job shows as skipped in `depot ci status`, not as passed or failed; the pull request's checks should list it as skipped too, which the first scoped pull request will confirm. When the scope job cannot read the paths for certain, its summary says why and every job runs; if it fails, every job behind it but `CI result` is skipped, and `CI result` and the run are red. Neither deploy can run behind a skipped job, and on `main` no job is skipped (the reasoning is in `ci.yml`, above the triggers). To run a job a pull request skipped, Lighthouse included, the whole workflow can be run by hand on the branch, `depot ci run --workflow .depot/workflows/ci.yml`, which is event `api`, never scoped; there a Lighthouse budget miss fails its shard, as on any event but a push or dispatch on `main`.

**The check a ruleset requires is `CI / CI result`**, the `ci-result` job, and no other. Depot reports each job to GitHub as a check run named `CI / <job name>`, published by the Depot Code Access app (`depot-code-access`), and GitHub documents a check run that concluded `skipped` as passing, so requiring a scoped job's check would let through every pull request that skipped it, the gate's included. `ci-result` needs the scope job, the gate and the three front-end jobs that run on a pull request, always runs, and leaves the verdict to `.depot/scripts/ci-result.mjs`, deny by default: the scope job must have succeeded, and each other job must have succeeded, except that on a pull request a job may be skipped when the scope job's output for its side, `plugin` for the gate and `web` for the front-end jobs, is `false`. A failed or cancelled scope job, a skip the outputs do not explain, or any skip off a pull request makes it red. It does not read Lighthouse, which never runs on a pull request, or the deploys. A new job goes in its `needs` (and the script's `JOBS`) or in the exempt list in `ci-scope.test.mjs`, whose test fails the scope job, and so `CI result`, until it does. The script's pull-request paths are tested in `ci-result.test.mjs`, which the scope job runs, since a `depot ci run` is never a pull request.

**The ruleset pins the check's source to the `depot-code-access` app**, so a check of the same name from anything else cannot satisfy it. Depot offers extra check-publishing apps, Depot Checks, Depot Checks 2 and Depot Checks 3, for organizations that reach GitHub's API rate limits; they publish the same check names, so with a pin in place a check one of them published would block the merge. Do not connect them while the pin stands (<https://depot.dev/docs/ci/observability/github-checks>, read 2026-11-07). The check means only what the workflow behind it says: Depot runs a pull request's own copy of `ci.yml` and `.depot/scripts/`, so a pull request can change `ci-result` itself, and the required check is worth something only with the owner's review of every change under `.depot/`. A cancelled run's `CI / CI result` concludes `cancelled` or `failure`, never green, so a cancelled run blocks the merge until it is re-run.

A new top-level path runs everything until a rule in `ci-scope.mjs` says otherwise; add the rule, and its case to `ci-scope.test.mjs`, in the pull request that adds the path.

### Preview Lighthouse

`.depot/workflows/preview-lighthouse.yml` measures a pull request's Vercel preview and posts one comment on it, blocking nothing (`apps/web/e2e/README.md`, "The design gates"). It runs on Depot CI on GitHub's `deployment_status` event, which Vercel sends for the GitHub Deployments it creates. Its first job, **Find the pull request and whether it reaches the front end**, takes a successful, non-production status from `vercel[bot]`, finds the open pull request whose head is the deployed commit, lists that pull request's files through GitHub's pull request files API and classifies them with `ci-scope.mjs --pr-files`, the same rules as the table above. The second job, **Measure the preview**, runs only when the `web` side is reached, or when the list is incomplete or unreadable, so in doubt it measures: a pull request that changes only `wp-content/` or inert paths posts nothing, spends about 4 seconds, and keeps any earlier comment as it was.

The comment is the Depot Code Access app's (`depot-code-access[bot]`): Depot's `github.token` is that app's installation token, and the app holds `pull_requests: write` and `issues: write` (`gh api apps/depot-code-access`, read 2026-11-07; Depot's compatibility page, <https://depot.dev/docs/ci/compatibility>, "Permissions", says the installation must grant what a job's `permissions` ask for). That page does not say the token is narrowed to what a job asks for, and the app also holds `contents: write`, `workflows: write`, `actions: write` and `secrets: read`, so until the check below has run, assume either job's token may carry all of them. Each job asks only for what it uses; the token is passed by name only to the steps that call GitHub's API, the checkouts leave none in `.git/config`, and lhci and Chrome never get it. A pull request that already has the comment `github-actions[bot]` left while the workflow ran on GitHub Actions gets a second one, which later previews edit.

**The trial, 2026-11-07: run f4q02z8k5s.** `depot ci run` reports event `api` and carries no `deployment_status` payload, so the trial ran the workflow with three temporary edits, removed before the commit: the first job's `if:` was `github.event_name == 'api'`, and the deployed commit and preview URL were PR #98's head (`a162a677`) and the `environment_url` of its Vercel deployment's success status, read with `gh api repos/Colbitron/resource-hub-wp/deployments/<id>/statuses`. Everything else ran as written: the lookup found #98, the files API listed its 38 files and `web=true`, all eight URLs were measured five times, every one of the 40 uploaded reports had the header redacted, every run's one foreign request was `vercel.live`, blocked, and the comment was posted on #98 by `depot-code-access[bot]`. The first job took 4 s and the measurement 8 min 15 s. The same classification run locally on merged PRs #92 (plugin only) and #95 (docs only) gave `web=false`.

**What the first real event must show**, on the first pull request after the merge whose preview deploys: a Preview Lighthouse run in `depot ci run list` with trigger `deployment_status` (if none appears, Depot is not receiving the event, and nothing else is wrong); the first job's log line `Deployed commit <sha>; this workflow runs from <sha>`, which says which commit's copy of the workflow Depot runs (GitHub runs the deployed commit's; Depot's docs do not say); and, for a front-end pull request, the comment edited or posted by `depot-code-access[bot]`, or, for a plugin-only or docs-only one, the measure job skipped and nothing posted. Until then the trigger, its payload fields (`deployment.sha`, `deployment.environment`, `deployment_status.environment_url`, `deployment_status.creator.login`) and the per-pull-request concurrency group are unexercised on Depot. Three more checks, once:

- **The log masks the secret.** In the measure job's log (`depot ci logs <attempt-id>`), the step environment shows `VERCEL_PROTECTION_BYPASS` as `***`, if Depot prints step environments as GitHub does, and a count-only search for the value finds nothing: with the value in the shell's environment as `VERC_DEP_PROT` (from wherever it is kept, never typed on the command line), `depot ci logs <attempt-id> | grep -cF -e "$VERC_DEP_PROT"` prints `0`. If the host does not mask, the outputs are still guarded: the reports are redacted and searched for the secret before they are written, and the comment before it is posted; only the log would need the workflow's own `::add-mask::`, which it already sends.
- **The token is narrowed to the job's `permissions:`.** First look for a token-permissions listing in the job's setup log, as GitHub prints under "Set up job"; if Depot prints one, that settles it. Otherwise run one temporary step at the top of the `pr` job, with `env: GH_TOKEN: ${{ github.token }}`, through `depot ci run` as the trial did (an `api` run's token is the same app's; a real event's run would answer more exactly), and remove it after: `gh api -i "repos/$GITHUB_REPOSITORY/actions/secrets?per_page=1" | grep -iE '^HTTP/|^x-accepted-github-permissions:' || true`. It reads (secret names only, and `grep` keeps even those out of the log) an endpoint that needs `secrets: read`, which the app holds and the job does not ask for. `-i` prints the response's headers, never the request's, so the token is not printed. A `200` means the token is not narrowed and carries the app's whole installation; a `403` with `X-Accepted-GitHub-Permissions: secrets=read` means it is narrowed (GitHub's "Troubleshooting the REST API" documents the header). An installation token has no scopes to read, so `X-OAuth-Scopes` says nothing here. If it is not narrowed, record it here and in the workflow's header, and weigh it with "The secrets are in reach of a pull request", below.
- **Two pull requests' previews at once do not cancel each other.** The measure job's concurrency group is the pull request's number, with the deployed commit as a fallback should Depot evaluate `needs` there as empty; two front-end pull requests deploying together should both get their comment.

### CI cost

The figures behind ADR 0053's "Cost". Depot's Developer plan is about $20 a month and includes 2,000 sandbox-minutes a month at 2 vCPU, shared with Depot's other sandbox products; past that it is $0.006 a minute for 2 vCPU, billed per second (<https://depot.dev/pricing>, read 2026-11-07; confirm there before relying on it).

**A run's sandbox-minutes**, the sum of its jobs' times (`depot ci workflow show <workflow-id>` lists each):

| Run | Sandbox-minutes | Trial run |
|---|---|---|
| Every job: a push to `main`, a dispatch, a `depot ci run` | 17.9: the measured 17.8 of run zkp83r7b3s, plus CI result's 0.07 (4 s). Its parts, each rounded and so not summing to the total: the five Lighthouse shards and the medians 11.1 (664 s), the gate 3.2, end-to-end 2.1, screenshots 0.8, checks 0.7, scope 0.05 | zkp83r7b3s; CI result 6nc6zbxd7m |
| A pull request reaching both sides, or a shared path | 6.9: the same run without Lighthouse | zkp83r7b3s |
| The front end alone | 3.6 | clmqq17s1c |
| The plugin alone | 3.1 | fxprsxt9wx |
| Documentation alone | 0.1: the scope job 0.05, CI result 0.07 | |

**The pull-request mix.** The 56 pull requests merged 2026-11-05 to 2026-11-07, Pacific time, classified by these rules: 26 both, 9 plugin, 17 front end, 4 neither. Weighted, (26 × 6.9 + 9 × 3.1 + 17 × 3.6 + 4 × 0.1) / 56 = 268.9 / 56, about 4.8 sandbox-minutes a pull request.

**A month at the pace of the four days before the move**: about 1,500 runs (`gh run list`), 28% of them pushes to `main`, so about 420 full runs and 1,080 pull-request runs.

| Rules | Sandbox-minutes a month | Cost a month |
|---|---|---|
| These: pull requests scoped by path, Lighthouse off them | 420 × 17.9 + 1,080 × 4.8 ≈ 12,700 | (12,700 − 2,000) × $0.006 ≈ $64, $84 with the plan |
| Lighthouse scoped by path like the other jobs, on the 43 of 56 pull requests that reach the front end: (268.9 + 43 × 11.1) / 56 ≈ 13.3 a pull request | 420 × 17.9 + 1,080 × 13.3 ≈ 21,900 | ≈ $119, $139 with the plan |
| Every job on every run | 1,500 × 17.9 = 26,850 | ≈ $149, $169 with the plan |

Most of what remains is `main`'s full runs, and each parallel job bills its own setup, so sharding buys a shorter wait with more billed minutes.

**Preview Lighthouse** runs once per preview, about once per pull-request run: its first job, about 4 s (0.07 sandbox-minutes), on every one, and the measurement, 8 min 15 s (8.25) in run f4q02z8k5s, on the 43 of 56 that reach the front end. Cancelled runs, when a newer preview of the same pull request supersedes one, are counted as whole.

| Preview Lighthouse | Sandbox-minutes a month | Cost a month, on top of CI's |
|---|---|---|
| Front-end pull requests only, as built: 0.07 + 43/56 × 8.25 ≈ 6.4 a pull-request run | 1,080 × 6.4 ≈ 6,900 | ≈ $41, so ≈ $126 in all with the plan |
| Every pull request: 0.07 + 8.25 ≈ 8.3 | 1,080 × 8.3 ≈ 9,000 | ≈ $54 |

At four runs a day in the same mix, a month stays within the plan's included minutes, Preview Lighthouse included: about 34 full runs × 17.9 + 86 pull-request runs × (4.8 + 6.4) ≈ 1,570.

## Secrets

Six secrets feed the two deploy jobs, and a seventh the Preview Lighthouse workflow. None is in git. All seven are Depot CI secrets scoped to this repository (`depot ci secrets list --repo Colbitron/resource-hub-wp` shows the names, never the values), and Depot's are the copies read: Preview Lighthouse runs on Depot CI too (ADR 0053). All seven stay in GitHub's repository secrets as well until the follow-up that removes the cutover switch, so a rollback to GitHub Actions needs no secret re-entered; delete them from GitHub after that, and set them there again only for a rollback.

| Secret | Holds |
|---|---|
| `DEPLOY_SSH_KEY` | Private half of a key used only for deploys |
| `DEPLOY_HOST` | SSH hostname or IP of the server |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_PATH` | Absolute path of the plugin directory itself, ending in `wp-content/plugins/resource-hub-wp`; the job refuses anything else, because `rsync --delete` into the wrong directory would remove other plugins |
| `DEPLOY_KNOWN_HOSTS` | The server's pinned host key line or lines, so the sandbox never trusts on first use |
| `VERCEL_DEPLOY_HOOK_URL` | The Vercel project's deploy hook for `main`; the URL is the credential |
| `VERCEL_PROTECTION_BYPASS` | The Vercel project's deployment protection bypass secret (Vercel env var `VERC_DEP_PROT`), sent as `x-vercel-protection-bypass` by `.depot/workflows/preview-lighthouse.yml` to reach a pull request's preview; nothing else reads it |

The CMS's own configuration (`RESOURCE_HUB_FRONTEND_URL`, `RESOURCE_HUB_REVALIDATE_SECRET`, and the optional `RESOURCE_HUB_POSTHOG_KEY` and `RESOURCE_HUB_POSTHOG_HOST`) is `define()`d in the host's `wp-config.php`. The front end's (`WP_API_URL`, `REVALIDATE_SECRET`, `SITE_URL`, optionally `WP_MEDIA_ORIGIN`) lives in the Vercel project's environment variables; `apps/web/README.md` describes each.

**The secrets are in reach of a pull request.** Depot CI runs the workflow as the pull request has it, and the secrets are scoped to the repository, not to `main`, so a pull request that edited the workflow could read them, as it could when they were GitHub repository secrets on this free plan. The cache is in reach too: Depot Cache is not isolated by branch (Depot documents that for its GitHub Actions runners; it is assumed for Depot CI), so a same-repository pull request whose workflow saved a cache entry could write a key that `main`'s runs then restore, and the deploy builds from what it installs. The only collaborator is the owner, so both are accepted. Before the repository goes public or takes outside pull requests, decide how to scope the deploy secrets, and add a GitHub ruleset on `main` that requires `CI / CI result` alone, from `depot-code-access` ("Which jobs a pull request runs", above). GitHub documents a skipped check as passing, which is why no scoped job's check is required; that a ruleset counts the check runs Depot publishes as it should is unconfirmed until the repository is public and the ruleset exists. Scoping a secret's variant to `main` alone (`depot ci secrets set <name> --repo Colbitron/resource-hub-wp --branch main`) would probably also hide it from a rollback, which is a dispatch on a tag ref, not on `main`; so either scope it to `main` and add a second variant matching the rollback tags (`rollback-*`; whether `--branch` matches a tag ref is unconfirmed, see `depot ci secrets set --help`), then dispatch on a throwaway tag to check the deploy job sees the secrets, or keep the repository-wide variant and accept that a pull request can read it. Only once the scoped variants work, remove the repository-wide one (`depot ci secrets list --repo Colbitron/resource-hub-wp` names each secret's variants), and confirm a pull request's run sees the secrets empty.

## The cutover switch, `DEPOT_DEPLOY_ENABLED`

Both deploy jobs also require the Depot CI variable `DEPOT_DEPLOY_ENABLED` to be `true`. It kept Depot's trial runs from deploying while GitHub's copy of the workflow still did, and while it is unset nothing on Depot CI reaches the host or Vercel, whatever the event or ref: the two jobs report as skipped.

**At the cutover**, in this order:

1. Merge the pull request that deletes `.github/workflows/ci.yml` with the variable still unset. The merge's push to `main` is then the first push run on Depot CI: it exercises the gate and saves the caches from `main`, and its two deploy jobs report as skipped.
2. Once that run is green, set the variable: `depot ci vars add DEPOT_DEPLOY_ENABLED --repo Colbitron/resource-hub-wp --value true`, and check it with `depot ci vars list --repo Colbitron/resource-hub-wp`.
3. Start the first Depot CI deploy by hand and watch it to the end: `depot ci dispatch --repo Colbitron/resource-hub-wp --workflow ci.yml --ref main`, then `depot ci status <run-id>` until both deploy jobs finish.

Before the merge, Depot CI ran one `pull_request` run, from PR #98's own copy of the workflow before it was scoped: run 8bt9mr07zz (`depot ci workflow show 2z7chvtrxv`: trigger `pull_request`, ref `refs/pull/98/merge`), so the merge ref the scope job diffs is confirmed. Every other trial was a `depot ci run` of local files, event `api`. The scoped `pull_request` path (the check names on the pull request, the Lighthouse jobs skipped, and the scope job's use of `github.event.pull_request.head.sha`) is first exercised by the first pull request run of the scoped workflow; check that run's jobs and checks, and that the scope job's summary lists the changed paths rather than "Every job runs: no pull request head SHA", which would mean Depot left the head SHA out and nothing is being scoped.

**Afterwards**, a follow-up pull request drops the variable's line from both jobs' `if:` and then the variable (`depot ci vars remove DEPOT_DEPLOY_ENABLED --repo Colbitron/resource-hub-wp --force`). Until it lands, removing the variable is the quickest way to stop Depot CI deploying.

## Rolling CI back to GitHub Actions

If Depot CI has to be left (ADR 0053, "Rollback"):

1. Relax the ruleset on `main` first, once there is one (the repository's Settings, Rules, or `gh api repos/Colbitron/resource-hub-wp/rulesets`): it requires `CI / CI result` from `depot-code-access`, which a run on GitHub Actions never publishes, so until it changes no pull request can merge, the rollback's own included. Remove the requirement, or require a check the restored workflow publishes from `github-actions`, and restore it if CI comes back to Depot.
2. Unset the switch, `depot ci vars remove DEPOT_DEPLOY_ENABLED --repo Colbitron/resource-hub-wp --force` (`--repo` selects the repository's variant; `--force` skips the confirmation prompt), so Depot CI deploys nothing while both run. This works only while the jobs still test it; after the follow-up, delete `.depot/workflows/ci.yml` in the same pull request as step 3 instead.
3. In a pull request, restore `.github/workflows/ci.yml` from git, and `screenshot-baselines.yml` and `preview-lighthouse.yml` if they are wanted. The files were deleted in different commits, so restore each from the parent of the commit that deleted it, one file at a time: `git log --diff-filter=D --format=%h -- .github/workflows/<file>` names that commit, and `git checkout <that commit>~1 -- .github/workflows/<file>` brings the file back. `ci.yml` and `screenshot-baselines.yml` were deleted together (`61c4d2aa`, "Retire GitHub Actions' CI"), `preview-lighthouse.yml` later, when it moved to Depot CI ("Run Preview Lighthouse on Depot CI"). Restoring `preview-lighthouse.yml` also means deleting `.depot/workflows/preview-lighthouse.yml` in the same pull request, so only one comments, and setting `COMMENT_AUTHOR` in `apps/web/e2e/lighthouse-preview-summary.mts` back to `github-actions[bot]`. Step 2 is what keeps the two from both deploying.
4. Make sure the six deploy secrets, the five `DEPLOY_*` and `VERCEL_DEPLOY_HOOK_URL`, are GitHub repository secrets, and with `preview-lighthouse.yml` restored all seven, `VERCEL_PROTECTION_BYPASS` included (`gh secret list`; `gh secret set <name>` for any that were deleted); and that the account has Actions minutes left: if the limit is reached, GitHub refuses the restored workflow's jobs until it resets or the budget is raised.
5. Merge; the push to `main` runs and deploys on GitHub Actions.

## The CMS deploy

The `deploy` job runs only after the gate passes, only for a push to `main` or a manual `workflow_dispatch` on `main` or a tag. One deploy runs at a time and a running deploy is never cancelled; a waiting run is replaced by a newer one, which is safe because the newer commit includes the older.

From a fresh checkout it builds the block, runs `composer install --no-dev` in the plugin directory, and rsyncs that directory over SSH into the plugin directory on the host with `--delete-delay --delay-updates`, so changed files swap in together at the end and stale ones are removed after. The rsync is an allowlist: the host receives `resource-hub.php`, `src/`, `build/` and `vendor/` and nothing else. **A new runtime file or directory has to be added to the allowlist in the workflow.** `packages/` never reaches the host.

It then activates the plugin with WP-CLI if it is not active, runs `wp rewrite flush` (activation clears the rules only when the plugin was inactive, so a deploy that changes the permalink structure would otherwise keep the old rules), reads the site's `home` URL over SSH and requests `{home}/wp-json/` to check that the REST API answers. WP-CLI runs from the WordPress root, because the host's `wp-config.php` requires `wp-salt.php` by a relative path.

If `/resources/` URLs 404 on the host after a change that the deploy did not flush, `wp rewrite flush` from the WordPress root is the manual equivalent. Locally, `pnpm wp rewrite flush`.

## The front-end deploy

The `deploy-web` job needs `deploy` and every front-end job (`web-checks`, `web-e2e`, `web-screenshots`, the five `web-lighthouse` shards and `web-lighthouse-medians`), runs only on `main` (a push or a dispatch from `main`, never a tag), reads `main`'s head through the API and fires the hook only if it is still the commit the run tested; otherwise it leaves a notice and the newer run deploys. A failed run that a newer push supersedes deploys nothing, and if the newer run fails, production stays at the last commit whose run fired the hook until the next green run on `main`. The hook answers with a queued job, and the step logs its id and state and ends: it does not wait on the build. **A green CI run means the build was queued, not that it succeeded**; a failed Vercel build leaves the previous production deployment serving, and its result is on Vercel.

**What it waits for.** On the commit, the front-end jobs must have passed the lint, typecheck, unit tests, production build and fixture-route check, the end-to-end suite (the axe scan and the document-size check included), the screenshots and the brand-image check, and every Lighthouse shard and the medians job, which run on `main` and never on a pull request. A Lighthouse budget miss does not hold the deploy back until issue #76 calibrates the gate: GitHub's runners, where CI ran until 2026-11-07, varied about 2–3x in CPU speed, so TBT on unchanged code moved between about 80 and 300 ms; on 2026-11-07 main's run 42362572282 missed it twice on code that had passed on its pull request, which skipped the deploy until it was started by hand, and PR #79 missed it at 201 and 209 ms against the 200 ms budget with no runtime change, which blocked its merge until a rerun. On a manual dispatch from any branch but `main`, or a tag, a miss still fails its shard's job. Only a missed budget is a warning: any other Lighthouse failure, where no failed assertion is on record (a broken harness, Chromium failing to launch, a build-stamp mismatch), fails its shard's job on every event and so blocks the deploy. WCAG A and AA accessibility stays gated by the axe scan in the end-to-end suite, which blocks the merge and the deploy on any WCAG A or AA violation.

**A Lighthouse warning on a `main` run is a finding to look at, not noise.** The run's annotations and the shard's job summary name each URL and metric that missed and its median, the `web-lighthouse-medians` job's summary has every URL's medians in one table, and the reports are in the `web-lighthouse-reports-<shard>` artifacts. A single miss just over budget on TBT is most likely a slow runner; if the same URL and metric miss again on the next run, or a median is well past its budget, or the miss is on accessibility or CLS, which do not depend on the runner's speed, treat it as a regression and fix it in a new pull request, checking the fix with the local smell test and, for CI's numbers, a `depot ci run` of the branch.

**The build reads the CMS.** Since 2026-11-07 (ADR 0043, amended) `next build` prerenders the library, each type's first page, the root and the newest resources from `WP_API_URL`: about 40 requests on the seed, up to about 140 with five full types, from every preview and production build. A CMS that does not answer costs the build one warning per route (`prerender {route}: nothing prerendered at build …`) and no prerendered page, never a failure; the deployed app then renders each page on its first request as before. The build's first step empties `.next/cache/fetch-cache` (`scripts/clear-fetch-cache.mts`, run by the `build` script), because Vercel restores that directory from its build cache and a stale copy of a CMS answer served to the build with the CMS down fails the build; so Vercel must run the `build` script, which `buildCommand` in `apps/web/vercel.json` sets to `pnpm build`. Do not replace it with `next build`. A revalidation event fired while a build runs clears the live deployment only, so the new deployment's prerendered pages carry pre-event data until the next event or the hourly interval.

On the Vercel project:

- Root Directory is `apps/web`.
- `apps/web/vercel.json` sets `git.deploymentEnabled.main` to `false`, so a push to `main` creates no Git-triggered production deployment, while every other branch and every pull request still gets a preview; and `buildCommand` to `pnpm build`, the script that empties the fetch cache before `next build` (above).
- "Automatically expose System Environment Variables" is on. `next.config.ts` recognises a Vercel build by the `VERCEL` variable and fails the build when `WP_API_URL` (or `WP_MEDIA_ORIGIN`) or `SITE_URL` is missing; with the setting off, a Vercel build without a base would deploy with every `/media/` image a 404.
- `WP_API_URL`, `REVALIDATE_SECRET` and `SITE_URL` are set for Production and for Preview, because Preview builds fail without them. On Preview, `SITE_URL` is the production origin, so a preview's canonical points at the public page.

**First-deploy check, closed 2026-11-06.** Two things were unconfirmed when the hook was built: whether a deploy hook still deploys a branch whose `deploymentEnabled` is `false`, and whether Vercel reads `git.deploymentEnabled` from `apps/web/vercel.json` when the Root Directory is `apps/web`. The merge of pull request #40 (`1c3e17f`) produced exactly one production deployment, created by the hook after CI. So the setting is read from `apps/web/vercel.json` with that Root Directory, and it does not block deploy hooks. The fallback that was held in reserve, an Ignored Build Step in the dashboard, is not needed.

## Rolling back

**The CMS** is rolled back by redeploying an earlier commit from a tag. Tag the good commit, push the tag, then dispatch the workflow on it on Depot CI:

```sh
git tag rollback-<date> <sha> && git push origin rollback-<date>
depot ci dispatch --repo Colbitron/resource-hub-wp --workflow ci.yml --ref rollback-<date>
```

Pushing a tag does not start CI, because the push trigger covers only `main`, so a tag deploy always takes that manual dispatch. The run goes through the gate before deploying. The tagged commit must contain the deploy job in `.depot/workflows/ci.yml`. A commit from before the move to Depot CI has none, so to roll back that far, branch from it, check out the current `.depot/` directory onto the branch, commit, and tag and dispatch that commit; this has not been exercised yet. A tag dispatch redeploys only the CMS.

**The front end** is rolled back on Vercel, by promoting an earlier production deployment (Instant Rollback). A hook cannot deploy a tagged commit, because it always builds `main`. After an Instant Rollback, Vercel stops assigning the production domain to new deployments, so the deploys `deploy-web` starts afterwards still build but are not served until someone undoes the rollback or promotes a deployment on Vercel; a green CI run on `main` does not end it.

A CMS rollback and a front-end rollback are two separate actions. Because contract changes are additive, a CMS rolled back one step still serves a front end that is one step ahead.

## Rotating secrets

A Depot CI secret is updated in place with `depot ci secrets set <name> --repo Colbitron/resource-hub-wp`, which prompts for the value (or `--from-stdin`, piping it with `printf '%s'`, so it never lands in the shell's history or a file); the variant scoped to this repository is the one replaced. A GitHub repository secret is updated with `gh secret set <name>`, which prompts too.

- **The deploy hook.** Create a new hook for `main` in the Vercel project's Git settings, update `VERCEL_DEPLOY_HOOK_URL` in Depot CI, then delete the old hook.
- **The protection bypass secret.** Regenerate it in the Vercel project's Deployment Protection settings, then update `VERCEL_PROTECTION_BYPASS` in Depot CI, where the Preview Lighthouse workflow reads it, and the local `VERC_DEP_PROT`. Until Depot's copy is updated the Preview Lighthouse comment reports a refused header; nothing deploys through it.
- **The revalidation secret.** It is one value on both sides: `RESOURCE_HUB_REVALIDATE_SECRET` in the host's `wp-config.php` and `REVALIDATE_SECRET` in the Vercel project. It must meet [the secret's rule](../../packages/ui/README.md#configuration); the CMS treats one that breaks it as not configured. Change the front end first, redeploy, then the CMS, then press "Send test revalidation" on Settings > Resource Hub, which sends a real event and records the result.
- **The deploy SSH key.** Generate a new key used only for deploys, add its public half on the host, update `DEPLOY_SSH_KEY` in Depot CI, then remove the old public key from the host.

Until the follow-up that removes the cutover switch, update a rotated secret in GitHub's repository secrets as well, the bypass secret included, so a rollback to GitHub Actions does not run with a revoked value.

## Verifying on a Vercel preview

What has not been measured on Vercel's CDN, to check on a preview deployment of a change to the routes or the headers:

- The `Cache-Control` a browser receives on a stored 308 from the resource page or the pages catch-all. Expected: `public, max-age=0, must-revalidate`, whether from the `headers()` rule or from the CDN's own handling of `s-maxage`.
- That a type change and a change back is followed by a browser with no kept redirect (webinar to podcast to webinar), and that the CDN purges the stored 308 on the event.
- That `/About/Team/` gets the proxy's `no-store` 308 and not a stored entry.
- `curl -I` on a listing, the resource page, its 308 and its 404 for the status and the header on the second request.

Whenever `proxy.ts`, its matcher, `components/DataNotFound.tsx` or the Next.js version changes, check the 404s too, since the e2e suite runs under `next start` only ([Not-found pages](../architecture/caching.md#not-found-pages)): `curl` the paths in `PATH_DECIDED` in `apps/web/e2e/errors.spec.ts` for status 404, `x-matched-path: /404` and the not-found heading in the body, and one unknown resource slug, twice, for status 404, `<h1>Page not found</h1>` in the body, no `__next_error__`, and `x-vercel-cache: HIT` the second time.

## Host notes

- **Cloudways Flexible on a DigitalOcean 2 GB server, PHP 8.4**, with Redis and Object Cache Pro live (connected, drop-in valid, checked 2026-11-04). wp-env has no persistent object cache, so PHPUnit cannot exercise persistence; that gets checked against the host.
- **Varnish and Cloudflare.** Observed 2026-11-04: Varnish passed `/wp-json` (no `Age` or `X-Cache` header, while the homepage was a HIT), and Cloudflare reported `cf-cache-status: DYNAMIC`. The plugin's `NoCacheHeader` makes that behaviour explicit and portable rather than dependent on the host's panel; no Varnish exclusion rule was added. The lockdown's 404 is uncacheable like every core 404, so every anonymous theme-page request reaches PHP.
- **WP-Cron spawns.** Checked 2026-11-04: `DISABLE_WP_CRON` is unset and there is no system crontab, so revalidation sends run at once. If a system cron ever replaces it, sends wait for its interval ([revalidation.md](../architecture/revalidation.md#when-wp-cron-does-not-run)).
- **HTTPS and the public URL** come from a subdomain the owner controls with a Let's Encrypt certificate; WordPress's `home` and `siteurl` are set to it, which makes it the `rest_url` base the front end sees.
- **The uploads directory** stays publicly reachable on the CMS: the front end's `/media/` rewrite and the image optimizer fetch from it, and the web server serves it without WordPress.
- **No filesystem writes** is a rule held by review and PHPCS, not by the host; Cloudways does not enforce a read-only codebase.
- **Local wp-env** reads the same constants from a gitignored `.wp-env.override.json` under `config`.
