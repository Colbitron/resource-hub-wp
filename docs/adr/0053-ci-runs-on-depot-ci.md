---
status: accepted
date: 2026-11-07
---

# CI runs on Depot CI, the deploys included

Every pull request and every push to `main` runs the gate: the plugin inside wp-env, the front end against its mock CMS. On `main` the same run deploys the CMS and then the front end (ADRs 0005, 0051). Until 2026-11-07 that ran on GitHub Actions. The repository is private on GitHub's free plan, and the gate used about 2,009 runner minutes in four days; the plan's spending limit was reached, and GitHub refused jobs from 2026-11-07 23:23 UTC, which stopped merges and deploys alike. Separately, the owner wants CI that keeps running through a GitHub Actions outage; issue #74 has the history.

**CI runs on Depot CI, from `.depot/workflows/`.** The workflows keep GitHub Actions' syntax. `ci.yml` began as the Depot migrator's copy of GitHub's and was then edited for Depot: the front end's one `web` job is split into parallel jobs, Lighthouse runs as five shards by URL with one more job merging their medians, and the jobs that run Node share a setup action. A pull request waits about 2.9 minutes, for the slowest job rather than the sum. GitHub's `ci.yml` and `screenshot-baselines.yml` are deleted, so nothing runs or deploys twice.

**The deploys run there, in the same order.** `deploy` needs the plugin's gate, so a front-end failure never blocks a CMS deploy or a rollback; `deploy-web` needs `deploy` and every front-end job, so the front end never goes live ahead of the CMS it reads or on a commit whose checks failed. Their secrets live in Depot.

## Considered options

- **Paying GitHub's overage.** About $33–78 a month at this pace, and every run still stops when GitHub Actions does. Rejected.
- **A self-hosted runner on the owner's Mac.** No minutes to buy, but CI then depends on the laptop being awake and online, and pull-request code runs on the machine that holds the owner's credentials. Rejected.
- **Depot's or Blacksmith's GitHub-runner products**, which keep GitHub Actions as the orchestrator and swap only the machine. Rejected: both are for GitHub organisations only, and this repository belongs to a personal account.
- **Staying on GitHub Actions.** Rejected: jobs stay refused until the limit resets, and an outage still stops every merge and deploy.

Depot CI was chosen because it accepts personal accounts and ran the whole suite natively in its trial, Docker and wp-env for the plugin and the amd64 Playwright image for the screenshots included.

## Consequences

- **Cost.** About $20 a month for the plan, plus sandbox time billed per second at $0.006 a minute for 2 vCPU. A run uses about 17 sandbox-minutes, about 10 cents.
- **The secrets live in Depot** (`depot ci secrets`), not in GitHub's repository secrets. Listing, rotating them and the cutover switch are in [`docs/runbooks/deploy.md`](../runbooks/deploy.md).
- **The checks change names** and are reported on pull requests by the `depot-code-access` GitHub app, not by GitHub Actions.
- **The ADR guard keeps its GitHub copy for now.** The check runs on `pull_request_target`, and its safety rests on running `main`'s copy of the workflow, never the pull request's. Depot runs a copy too; until a cutover pull request shows that Depot runs `main`'s copy, GitHub's `.github/workflows/adr-approval.yml` stays, and both copies are guarded paths.
- **`preview-lighthouse.yml` stays on GitHub.** Depot CI does not support its `deployment_status` trigger, and the run is informational, so a GitHub outage costs a comment, never a merge or a deploy.
- **Lighthouse is sharded by URL.** Each URL's five runs stay in one shard on its own 2-vCPU sandbox, so a shard asserts what a single run of the whole list would for its URLs, and the medians are merged into one table.
- **Rollback** is restoring `.github/workflows/ci.yml` from git and unsetting the Depot variable `DEPOT_DEPLOY_ENABLED`, which keeps Depot's deploy jobs off while they still test it. The steps are in the runbook.
