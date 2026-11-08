---
status: accepted
date: 2026-11-07
---

# CI runs on Depot CI, the deploys included

Every push to `main` runs the whole gate and then deploys the CMS and then the front end (ADRs 0005, 0051); every pull request runs the part of the gate its changes reach. Until 2026-11-07 that ran on GitHub Actions. The repository is private on GitHub's free plan; the gate used about 2,009 runner minutes in four days, the plan's spending limit was reached, and GitHub refused jobs from 2026-11-07 23:23 UTC, stopping merges and deploys alike. The owner also wants CI that keeps running through a GitHub Actions outage; issue #74 has the history.

**CI runs on Depot CI, from `.depot/workflows/`.** The workflows keep GitHub Actions' syntax. `ci.yml` began as the Depot migrator's copy of GitHub's; the front end's one job is now parallel jobs, Lighthouse among them as five shards by URL and a job merging their medians. A run waits about three minutes, for the slowest job rather than the sum. GitHub's `ci.yml` and `screenshot-baselines.yml` are deleted, so nothing runs or deploys twice.

**A pull request runs only the jobs its changes reach, and never Lighthouse.** Depot bills each job's sandbox time, so a first job, `scope`, classifies the paths the pull request's merge commit changes and skips the jobs they cannot reach; a docs-only pull request runs `scope` alone. `.depot/scripts/ci-scope.mjs` has the rules, and the runbook's table what each change runs. When the paths cannot be read for certain, every job runs. Pushes to `main` and dispatches are never scoped. Lighthouse's shards and medians run only off pull requests, on a push to `main`, a dispatch or a `depot ci run` (event `api`): they were most of a run's cost, and until issue #76 a budget miss blocks nothing. Before pushing a front-end change the author runs `pnpm web:test:lighthouse:quick`, a local smell test, not a gate.

**The deploys run there, in the same order.** `deploy` needs the plugin's gate, so a front-end failure never blocks a CMS deploy or a rollback; `deploy-web` needs `deploy` and every front-end job, so the front end never goes live ahead of the CMS it reads or on a commit whose checks failed. On `main` every job runs, so `deploy-web` still waits on every Lighthouse shard.

## Considered options

- **Paying GitHub's overage.** About $33–78 a month at this pace, and every run still stops when GitHub Actions does. Rejected.
- **A self-hosted runner on the owner's Mac.** No minutes to buy, but CI then depends on the laptop being awake and online, and pull-request code runs on the machine that holds the owner's credentials. Rejected.
- **Depot's or Blacksmith's GitHub-runner products**, which keep GitHub Actions as the orchestrator and swap only the machine. Rejected: both install on a GitHub organisation, and this repository belongs to a personal account. Blacksmith's quickstart says it is limited to organisations and not available for personal repositories (<https://docs.blacksmith.sh/introduction/quickstart>); Depot's runner quickstart connects a GitHub organisation and its runner groups (<https://depot.dev/docs/github-actions/quickstart>).
- **Lighthouse on pull requests too**, scoped by path like the other jobs: about 11 sandbox-minutes on every front-end pull request for misses that block nothing until #76. Rejected; its cost is below.
- **Staying on GitHub Actions.** Rejected: jobs stay refused until the limit resets, and an outage still stops every merge and deploy.

Depot CI was chosen because it accepts personal accounts and ran the whole suite natively in its trial, Docker and wp-env for the plugin and the amd64 Playwright image for the screenshots included.

## Consequences

- **Cost.** About $20 a month for the Developer plan, 2,000 sandbox-minutes a month at 2 vCPU included, then $0.006 a minute (<https://depot.dev/pricing>, read 2026-11-07). A full run, on `main` or a dispatch, uses about 17.8 sandbox-minutes, 11 of them Lighthouse; a typical pull request about 4.7. At the pace before the move, about 1,500 runs a month, that is about $83, a little past the rejected overage, against about $168 with every job on every run and $139 with Lighthouse scoped like the rest. The move is for the limit and the outage, not the price. The evidence is in [`docs/runbooks/deploy.md`](../runbooks/deploy.md), "CI cost".
- **The secrets live in Depot** (`depot ci secrets`), not GitHub; listing, rotating them and the cutover switch are in [`docs/runbooks/deploy.md`](../runbooks/deploy.md).
- **The checks change names** and are reported on pull requests by the `depot-code-access` GitHub app, not by GitHub Actions.
- **The ADR guard keeps its GitHub copy for now.** The check runs on `pull_request_target`, and its safety rests on running `main`'s copy, never the pull request's. Depot runs a copy too, and both copies are guarded paths. GitHub's `.github/workflows/adr-approval.yml` stays the check of record while GitHub Actions runs jobs, and Depot's copy is trusted only once tested; `.claude/rules/adr.md` has the test.
- **`preview-lighthouse.yml` stays on GitHub for now; moving it is a follow-up.** Depot lists its `deployment_status` trigger as supported. It is informational: if GitHub's limit is reached again, that costs a comment, never a merge or a deploy.
- **A Lighthouse error first shows up on `main`.** A crash, missing runs or a failed upload is no longer caught before the merge: it fails `main`'s run and holds `deploy-web` back until a fix lands, while the CMS deploy goes ahead. A budget regression likewise first appears there, as a warning; the smell test should catch most breakages, but it is not a gate. `depot ci run` on a branch runs Lighthouse, for CI's numbers before a merge, and `preview-lighthouse.yml` still measures each pull request's Vercel preview, blocking nothing.
- **Lighthouse is sharded by URL**, each URL's five runs in one shard on its own 2-vCPU sandbox, so a shard asserts what one run of the whole list would.
- **Rollback** is restoring `.github/workflows/ci.yml` from git and unsetting the Depot variable `DEPOT_DEPLOY_ENABLED`, which keeps Depot's deploy jobs off. It needs Actions minutes: if GitHub's limit is reached again, the restored jobs wait for the reset or a raised budget. The steps are in the runbook.
