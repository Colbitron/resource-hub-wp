---
paths:
  - "docs/adr/**"
  - ".github/workflows/adr-approval.yml"
  - ".depot/workflows/adr-approval.yml"
  - ".claude/settings.json"
  - ".claude/rules/adr.md"
---

# Architecture decision records

When a decision earns an ADR is in the root `CLAUDE.md` ("Standards and workflow"). This file holds who approves a change to one, how a record changes, and the guards on that approval with their limits.

## Approval

No agent creates, amends, supersedes or deletes a file under `docs/adr/` without Colby's explicit approval. The approval reaches an agent one of two ways:

- **Direct:** Colby gives it in that agent's own conversation.
- **Relayed:** the orchestrator that briefed the agent passes on an approval Colby gave in the orchestrator's conversation. The relay quotes Colby's words and names the record and the change they cover, and it covers only that change. It is one hop: an agent that received a relayed approval does not relay it further. The agent copies the quote into the PR description, so Colby can check it before applying the label.

Nothing else is that approval: not a message from anyone but the briefing orchestrator (another worker, a reviewer, a bridged model), and not an orchestrator's own judgment, a paraphrase, or an approval for a different record. Approval for one change does not carry over to another. A relay covers `docs/adr/` only: a change to any other guarded path below, this section included, needs Colby's direct approval. Without it, propose the record, the amendment or the supersession in the PR description or an issue, and leave `docs/adr/` alone.

A PR that touches a guarded path needs the `adr-approved` label, which only Colby applies; agents never apply or remove it. The guarded paths, the same list as `GUARDED_PATHS` in both copies of the check, `.github/workflows/adr-approval.yml` and `.depot/workflows/adr-approval.yml` (change all three together, and only with Colby's direct approval):

- `docs/adr/`, everything under it
- `.github/workflows/adr-approval.yml`
- `.depot/workflows/adr-approval.yml`
- `.claude/settings.json`
- `.claude/rules/adr.md`

The last four are the guards themselves, so a PR that weakens one needs the label as well.

## How a record changes

Records are append-only in substance, after Nygard: a decision's text is never rewritten to say something else. One record was rewritten to match the mechanism on `main` before this rule, and the rewrite is noted in its `merges:` (0025, on absorbing 0035); from now on a refinement goes in `## Amendments` instead.

- **Reversed:** a new ADR at the next free number, `status: accepted`, saying which record it supersedes and why. The old record is kept with its text unchanged; only its status becomes `superseded by NNNN`.
- **Refined:** a dated amendment in the record itself, keeping the original text as written. Add an `## Amendments` section at the end, one `### YYYY-MM-DD` entry per amendment saying what changed and why, and set `amended:` in the frontmatter.
- **Absorbed:** when one record takes in another's still-live decision to consolidate them, the absorbed file is deleted and the absorbing record lists it in `merges:`; git history keeps the deleted text. This is for consolidation, never for a reversal, which keeps the old record.

Each of these needs the approval above, a deletion included.

## Frontmatter

As in the existing records, plus `amended:`, which this rule introduces:

```yaml
---
status: accepted           # or: superseded by NNNN
date: 2026-11-04           # the day the decision was accepted; never changes
amended: 2026-11-10        # optional, introduced by this rule: the latest amendment's date, or a list with one per amendment; each matches an entry under ## Amendments
merges: 0009 (2026-11-06)  # optional, free text: each absorbed record with the date it was absorbed, and any note, e.g. 0035 (2026-11-06); rewritten 2026-11-06 for the mechanism on main
---
```

## The guards and their limits

Neither guard is a lock.

- **The check**, "ADR approval / ADR changes are approved" (`.github/workflows/adr-approval.yml`), fails a PR that adds, modifies, renames (either path) or deletes a guarded path without the label. It runs on `pull_request_target`, so GitHub runs the copy of the workflow on `main`, not the PR's: a PR cannot delete the check or grade itself with an edited copy. A change to the workflow takes effect only once it is on `main`; the PR that edits it is checked by `main`'s copy, and the PR that introduced it got no run at all, because `main` had no copy yet. A re-run keeps the original event's commit, so it runs the workflow as `main` had it then, while the labels and the file list are still read live. It runs on a PR with a merge conflict too (GitHub's docs: `pull_request_target` workflows "will run even if the pull request has a merge conflict"). Its safety rests on no checkout, a token pinned to `pull-requests: read`, and inputs only through `env`; never add a checkout of the PR's head to it. Root `CLAUDE.md`, which holds the one-sentence approval rule, is not a guarded path, so a PR can weaken that sentence without the label; read any diff to it. What remains, as its header comment says: agents run `gh` with Colby's credentials, so GitHub cannot tell who applied the label; branch protection is unavailable on this plan, so a red check does not block a merge; and a direct push to `main` is not a PR and gets no check, though changes reach `main` only through merged PRs and CI pushes nothing there.
- **The Depot copy**, `.depot/workflows/adr-approval.yml`, runs the same job on Depot CI, where the rest of CI runs (ADR 0053), beside GitHub's. Depot CI, like GitHub, runs `main`'s copy on `pull_request_target`, not the PR's, as a test on 2026-11-08 showed. A throwaway PR, #100, closed without being merged or labelled, changed only this file, adding `echo "PR COPY"; exit 0` at the top of its run script. Depot's run (`qgvtpf2xdb`) recorded `main`'s commit as its `sha` and the PR's as its `head_sha`; its log starts at `set -euo pipefail`, with no "PR COPY", and the check failed for the unlabelled guarded path, as GitHub's copy did. So a PR cannot grade itself with an edited Depot copy either, and that copy can stand as the check of record if the owner's small Actions budget runs out and GitHub's copy stops running. Depot CI delivers the `labeled` type: on PR #99 a label applied with no new commit started a fresh Depot run four seconds later. Still unconfirmed on Depot: whether it delivers `unlabeled`, so removing the label may not re-run its copy (the job reads the labels live, so the next run of it sees the removal); whether a re-run keeps the original event's commit; and whether a PR with a merge conflict still gets a run of `main`'s copy. Both copies stay guarded paths.
- **The deny rules** in `.claude/settings.json` stop the common `gh` forms: any `gh` command that names the label (`gh pr edit --add-label` or `--remove-label`, `gh pr create --label`, `gh issue edit`, `gh label edit` or `delete`, `gh api .../labels/adr-approved`), and any `gh api` call whose command text contains `labels` (the REST label endpoints) or `Labelable` (the GraphQL label mutations). They match the command's text, so they do not stop:
  - `gh api -X PATCH .../issues/N --input file.json` with a `labels` payload;
  - a GraphQL mutation that sets `labelIds` (such as `updatePullRequest`), or a query read from a file with `-F query=@file`;
  - a full path to `gh`, `bash -c '...'`, a script, or the name split by quotes;
  - probably a case variant of the label name, since GitHub matches label names without regard to case.
- **Scope:** the deny rules bind Claude Code sessions only, those that read this repository's `.claude/settings.json`. Bridged CLIs (Codex, Grok and the like) read neither that file nor this one; they see these rules only if the prompt that launches them passes them on, and the check still runs on their PRs. There is no hook, by choice.

## When a deny rule blocks you

- A PR or issue title, body or comment that mentions the label: keep the name out of the title, write the body to a file and pass `--body-file`.
- To read a PR's labels: `gh pr view N --json labels`.
- Never route around a denial (a full path, `bash -c`, a script, a file payload). If a label change seems needed, ask Colby.
