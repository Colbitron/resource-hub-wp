# Deploying, rolling back and rotating secrets

For the maintainer deploying the CMS or the front end, rolling either back, or rotating a secret. The decisions are [ADR 0005](../adr/0005-hosted-wordpress-on-cloudways.md) (the host) and [ADR 0051](../adr/0051-front-end-production-deploys-through-a-vercel-deploy-hook.md) (the front-end deploy); the workflow is `.github/workflows/ci.yml`, whose comments explain each step.

## How a deploy happens

Nothing is deployed by hand. A push to `main` runs the gate, then the `deploy` job syncs the plugin to the Cloudways host, then the `deploy-web` job starts the front end's Vercel production build. The CMS goes first and the front end second, so the front end never goes live ahead of the CMS it reads; additive contract changes make that order safe. The CMS deploy needs only the CMS gate, so a front-end failure never blocks a CMS deploy or a rollback. Pull requests and other branches never deploy; pull requests get Vercel preview deploys.

## Secrets

Six repository secrets feed the two deploy jobs. None is in git.

| Secret | Holds |
|---|---|
| `DEPLOY_SSH_KEY` | Private half of a key used only for deploys |
| `DEPLOY_HOST` | SSH hostname or IP of the server |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_PATH` | Absolute path of the plugin directory itself, ending in `wp-content/plugins/resource-hub-wp`; the job refuses anything else, because `rsync --delete` into the wrong directory would remove other plugins |
| `DEPLOY_KNOWN_HOSTS` | The server's pinned host key line or lines, so the runner never trusts on first use |
| `VERCEL_DEPLOY_HOOK_URL` | The Vercel project's deploy hook for `main`; the URL is the credential |

The CMS's own configuration (`RESOURCE_HUB_FRONTEND_URL`, `RESOURCE_HUB_REVALIDATE_SECRET`, and the optional `RESOURCE_HUB_POSTHOG_KEY` and `RESOURCE_HUB_POSTHOG_HOST`) is `define()`d in the host's `wp-config.php`. The front end's (`WP_API_URL`, `REVALIDATE_SECRET`, `SITE_URL`, optionally `WP_MEDIA_ORIGIN`) lives in the Vercel project's environment variables; `apps/web/README.md` describes each.

**The free-plan caveat.** The repository is private on a free plan, which offers neither environments nor branch rulesets, so a pull request that edited the workflow could reach the repository secrets. The only collaborator is the owner, so this is accepted. When the repository goes public, move the deploy secrets to a `production` environment limited to `main` and add a ruleset that requires the gate on `main`.

## The CMS deploy

The `deploy` job runs only after the gate passes, only for a push to `main` or a manual `workflow_dispatch` on `main` or a tag. One deploy runs at a time and a running deploy is never cancelled; GitHub keeps one waiting run and replaces it with a newer one, which is safe because the newer commit includes the older.

From a fresh checkout it builds the block, runs `composer install --no-dev` in the plugin directory, and rsyncs that directory over SSH into the plugin directory on the host with `--delete-delay --delay-updates`, so changed files swap in together at the end and stale ones are removed after. The rsync is an allowlist: the host receives `resource-hub.php`, `src/`, `build/` and `vendor/` and nothing else. **A new runtime file or directory has to be added to the allowlist in the workflow.** `packages/` never reaches the host.

It then activates the plugin with WP-CLI if it is not active, runs `wp rewrite flush` (activation clears the rules only when the plugin was inactive, so a deploy that changes the permalink structure would otherwise keep the old rules), reads the site's `home` URL over SSH and requests `{home}/wp-json/` to check that the REST API answers. WP-CLI runs from the WordPress root, because the host's `wp-config.php` requires `wp-salt.php` by a relative path.

If `/resources/` URLs 404 on the host after a change that the deploy did not flush, `wp rewrite flush` from the WordPress root is the manual equivalent. Locally, `pnpm wp rewrite flush`.

## The front-end deploy

The `deploy-web` job needs both `deploy` and `web`, runs only on `main` (a push or a dispatch from `main`, never a tag), reads `main`'s head through the API and fires the hook only if it is still the commit the run tested; otherwise it leaves a notice and the newer run deploys. A failed run that a newer push supersedes deploys nothing, and if the newer run fails, production stays at the last commit whose run fired the hook until the next green run on `main`. The hook answers with a queued job, and the step logs its id and state and ends: it does not wait on the build. **A green CI run means the build was queued, not that it succeeded**; a failed Vercel build leaves the previous production deployment serving, and its result is on Vercel.

**What it waits for.** On the commit, `web` must have passed its lint, typecheck, unit tests, production build and fixture-route check, the end-to-end suite (the axe scan and the document-size check included), the screenshots and the brand-image check. Lighthouse CI runs in the same job but does not hold the deploy back until issue #76 calibrates it: GitHub's runners vary about 2–3x in CPU speed, so TBT on unchanged code moved between about 80 and 300 ms, and on 2026-11-07 main's run 42362572282 missed it twice on code that had passed on its pull request, which skipped the deploy until it was started by hand. On pull requests, and on a manual dispatch from any branch but `main`, a Lighthouse miss still fails `web`, so the budgets still decide merges.

**A Lighthouse warning on a `main` run is a finding to look at, not noise.** The run's annotations and the `web` job's summary name each URL and metric that missed and its median, and the reports are in the `web-lighthouse-reports` artifact. A single miss just over budget on TBT is most likely a slow runner; if the same URL and metric miss again on the next run, or a median is well past its budget, or the miss is on accessibility or CLS, which do not depend on the runner's speed, treat it as a regression and fix it in a pull request, where the budget blocks as usual.

On the Vercel project:

- Root Directory is `apps/web`.
- `apps/web/vercel.json` sets `git.deploymentEnabled.main` to `false`, so a push to `main` creates no Git-triggered production deployment, while every other branch and every pull request still gets a preview.
- "Automatically expose System Environment Variables" is on. `next.config.ts` recognises a Vercel build by the `VERCEL` variable and fails the build when `WP_API_URL` (or `WP_MEDIA_ORIGIN`) or `SITE_URL` is missing; with the setting off, a Vercel build without a base would deploy with every `/media/` image a 404.
- `WP_API_URL`, `REVALIDATE_SECRET` and `SITE_URL` are set for Production and for Preview, because Preview builds fail without them. On Preview, `SITE_URL` is the production origin, so a preview's canonical points at the public page.

**First-deploy check, closed 2026-11-06.** Two things were unconfirmed when the hook was built: whether a deploy hook still deploys a branch whose `deploymentEnabled` is `false`, and whether Vercel reads `git.deploymentEnabled` from `apps/web/vercel.json` when the Root Directory is `apps/web`. The merge of pull request #40 (`1c3e17f`) produced exactly one production deployment, created by the hook after CI. So the setting is read from `apps/web/vercel.json` with that Root Directory, and it does not block deploy hooks. The fallback that was held in reserve, an Ignored Build Step in the dashboard, is not needed.

## Rolling back

**The CMS** is rolled back by redeploying an earlier commit from a tag. Tag the good commit, push the tag, then dispatch the workflow on it:

```sh
git tag rollback-<date> <sha> && git push origin rollback-<date>
gh workflow run ci.yml --ref rollback-<date>
```

Pushing a tag does not start CI, because the push trigger covers only `main`, so a tag deploy always takes that manual dispatch. The run goes through the gate before deploying. The tagged commit must contain the deploy job. A tag dispatch redeploys only the CMS.

**The front end** is rolled back on Vercel, by promoting an earlier production deployment (Instant Rollback). A hook cannot deploy a tagged commit, because it always builds `main`. After an Instant Rollback, Vercel stops assigning the production domain to new deployments, so the deploys `deploy-web` starts afterwards still build but are not served until someone undoes the rollback or promotes a deployment on Vercel; a green CI run on `main` does not end it.

A CMS rollback and a front-end rollback are two separate actions. Because contract changes are additive, a CMS rolled back one step still serves a front end that is one step ahead.

## Rotating secrets

- **The deploy hook.** Create a new hook for `main` in the Vercel project's Git settings, update `VERCEL_DEPLOY_HOOK_URL`, then delete the old hook.
- **The revalidation secret.** It is one value on both sides: `RESOURCE_HUB_REVALIDATE_SECRET` in the host's `wp-config.php` and `REVALIDATE_SECRET` in the Vercel project. It must meet [the secret's rule](../../packages/ui/README.md#configuration); the CMS treats one that breaks it as not configured. Change the front end first, redeploy, then the CMS, then press "Send test revalidation" on Settings > Resource Hub, which sends a real event and records the result.
- **The deploy SSH key.** Generate a new key used only for deploys, add its public half on the host, update `DEPLOY_SSH_KEY`, then remove the old public key from the host.

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
