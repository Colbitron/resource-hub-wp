---
status: accepted
date: 2026-11-07
amended: [2026-11-07, 2026-11-07, 2026-11-08]
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

## Amendments

### 2026-11-07: Preview Lighthouse moves to Depot CI

**What changed.** Preview Lighthouse runs on Depot CI from `.depot/workflows/preview-lighthouse.yml`, on `deployment_status`, and GitHub's copy is deleted, so GitHub Actions now runs only the ADR guard's GitHub copy. It measures only pull requests whose changed files reach the front end, by `ci-scope.mjs --pr-files`, and measures when those files cannot be read for certain. It comments as `depot-code-access[bot]`, still blocking nothing. A measured preview costs about 8.3 sandbox-minutes: about $41 a month at the pace above, $125 in all with the plan, and within the included minutes at four runs a day ([`docs/runbooks/deploy.md`](../runbooks/deploy.md), "CI cost"). Depot lists the trigger as supported; the first real event confirms it (the runbook's "Preview Lighthouse" checklist). This replaces the consequence "`preview-lighthouse.yml` stays on GitHub for now", which stays above as written; "each pull request's Vercel preview" above now means each front-end one.

**What did not.** The decision and the other consequences: pull requests still run only the jobs their changes reach and never CI's Lighthouse, and the ADR guard keeps its GitHub copy.

### 2026-11-07: Depot's copy of the ADR guard passed its trust test

**What changed.** The trust test that "Depot's copy is trusted only once tested" waited on has run: a throwaway pull request, #100, closed without being merged or labelled, edited only `.depot/workflows/adr-approval.yml`, and Depot CI ran `main`'s copy of it on `pull_request_target`, not the pull request's, as GitHub does. So Depot's copy can stand as the check of record if GitHub's stops running. The test's instructions are gone from `.claude/rules/adr.md`, which now records the result and what is still unconfirmed on Depot.

**What did not.** Both copies keep running and both stay guarded paths; retiring GitHub's copy is a separate decision for Colby. The consequence "Depot's copy is trusted only once tested; `.claude/rules/adr.md` has the test" stays above as written.

### 2026-11-08: the CMS rolls back by a dispatch on `main` with a SHA input, and a rollback to GitHub Actions needs the secrets set again

**What changed.** A CMS rollback is a `workflow_dispatch` of `ci.yml` on `main` whose `rollback_sha` input names an earlier commit of `main`; the gate and the deploy check out `main`'s full history, refuse the input unless it is a full SHA that is an ancestor of `main`'s head at or after the deploy job's floor (`.depot/scripts/rollback-target.mjs`, failing closed), and then build, test and deploy that commit, while the front-end jobs and `deploy-web` are skipped and the front end is rolled back on Vercel (ADR 0051). The tag dispatch the runbook once described never worked here: Depot refuses `depot ci dispatch --ref <tag>` ("Workflow … not found or does not have workflow_dispatch trigger", canary probe, 2026-11-07), and since 2026-11-08 the six deploy secrets have one variant each, scoped to `repository=colbitron/resource-hub-wp` and `branch=main`, so a run on any other ref reads them as empty. Issue #130 has the design; [`docs/runbooks/deploy.md`](../runbooks/deploy.md), "Rolling back", the procedure and what the first real dispatch must show. Separately, the "Rollback" consequence above leaves out a step that scoping made necessary: rolling CI back to GitHub Actions now also means setting the six deploy secrets again as GitHub repository secrets before the merge, because their GitHub copies were deleted on 2026-11-08 once nothing on GitHub Actions read them; the runbook's "Rolling CI back to GitHub Actions" has the order.

**What did not.** The decision and the deploys' order: the CMS deploys first, then the front end, and `deploy` still needs only the plugin's gate. The "Rollback" consequence stays above as written; it is read with this amendment.
