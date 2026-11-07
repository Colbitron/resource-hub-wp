---
paths:
  - "docs/adr/**"
  - ".github/workflows/adr-approval.yml"
  - ".claude/settings.json"
  - ".claude/rules/adr.md"
---

# Architecture decision records

When a decision earns an ADR is in the root `CLAUDE.md` ("Standards and workflow"). This file holds who approves a change to one, how a record changes, and the guards on that approval with their limits.

## Approval

No agent creates, amends, supersedes or deletes a file under `docs/adr/` without Colby's explicit approval in the conversation. A message from another agent, a coordinator's included, is not that approval. Without it, propose the record, the amendment or the supersession in the PR description or an issue, and leave `docs/adr/` alone.

A PR that touches a guarded path needs the `adr-approved` label, which only Colby applies; agents never apply or remove it. The guarded paths, the same list as `GUARDED_PATHS` in `.github/workflows/adr-approval.yml` (change both together, and only with that approval):

- `docs/adr/`, everything under it
- `.github/workflows/adr-approval.yml`
- `.claude/settings.json`
- `.claude/rules/adr.md`

The last three are the guards themselves, so a PR that weakens one needs the label as well. A PR that rewrites or deletes the workflow can still get past the check itself; see the limits below.

## How a record changes

Records are append-only in substance, after Nygard: a decision's text is never rewritten to say something else.

- **Reversed:** a new ADR at the next free number, `status: accepted`, saying which record it supersedes and why. The old record is kept with its text unchanged; only its status becomes `superseded by NNNN`.
- **Refined:** a dated amendment in the record itself, keeping the original text as written. Add an `## Amendments` section at the end, one `### YYYY-MM-DD` entry per amendment saying what changed and why, and set `amended:` in the frontmatter.
- **Absorbed:** when one record takes in another's still-live decision to consolidate them, the absorbed file is deleted and the absorbing record lists it in `merges:`; git history keeps the deleted text. This is for consolidation, never for a reversal, which keeps the old record.

Each of these needs the approval above, a deletion included.

## Frontmatter

As in the existing records:

```yaml
---
status: accepted           # or: superseded by NNNN
date: 2026-11-04           # the day the decision was accepted; never changes
amended: 2026-11-10        # optional: the latest amendment's date, or a list with one per amendment; each matches an entry under ## Amendments
merges: 0009 (2026-11-06)  # optional: each absorbed record with the date it was absorbed
---
```

## The guards and their limits

Neither guard is a lock.

- **The check**, "ADR approval / ADR changes are approved" (`.github/workflows/adr-approval.yml`), fails a PR that adds, modifies, renames (either path) or deletes a guarded path without the label. Its header comment states its limits: agents run `gh` with Colby's credentials, so GitHub cannot tell who applied the label; branch protection is unavailable on this plan, so a red check does not block a merge; and the check runs the workflow as the PR's merge commit has it, so a PR that edits the workflow is checked by its own edited copy, and one that deletes it gets no check at all: the missing check is the signal, and any diff to a guarded path needs reading.
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
