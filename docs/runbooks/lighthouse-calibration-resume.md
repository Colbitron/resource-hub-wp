# Resuming the calibrated Lighthouse gate

This is for whoever picks up the Lighthouse CPU calibration that was parked on 2026-11-07. #71 and #72 shipped with Lighthouse's fixed 4x CPU slowdown and a median of five runs. GitHub's runners are faster than the reference phone, so at 4x that gate is gentler than a calibrated one. This page says what was found, where the work is kept and how to finish it. Issue #76 tracks it, and its V3 section holds the Vercel preview results.

## What exists and where

| What | Where |
|---|---|
| The calibrated gate, as work in progress | Branch `lhci/snapshot-calibration`, built on #71's c65f34b |
| The method, the constant and its bounds | `apps/web/e2e/cpu-calibration.mts`; tests in `apps/web/test/cpu-calibration.test.ts` |
| The frozen built page and its server | `apps/web/e2e/calibration-page/` (generated, ignored by ESLint) and `apps/web/e2e/calibration-page.mts` |
| The page's generator, which also measures the host | `apps/web/e2e/write-calibration-page.mts`, run as `pnpm --filter resource-hub-web lighthouse:calibration-page` |
| The gate runner and the code it shares with the generator | `apps/web/e2e/lighthouse.mts` and `apps/web/e2e/lab.mts` |
| The summary table's columns (W, multiplier, index) | `apps/web/e2e/lighthouse-summary.mts` |
| The experiment that found the problem | `apps/web/e2e/experiments/lh-experiment.mts`, `lhx-reference.mts` and the disabled workflow `lhci-experiment.yml.txt` |
| The experiment's numbers | `apps/web/e2e/experiments/evidence/` (`README.md` first) |

The branch's `e2e/README.md` still describes #71's `benchmarkIndex` method. Rewriting it is part of finishing the work.

## What was found

- Lighthouse's simulated throttling multiplies the host's own main-thread task times by a constant. The documented way to pick that constant is to put the host's `benchmarkIndex` through the CPU slowdown calculator.
- **On GitHub's runners the index mispredicts this site's main-thread work.** The experiment covered four runner CPUs: EPYC 9V45 (index about 3,700), EPYC 9V74 (about 2,400), EPYC 7763 (about 1,850) and Xeon 6975P-C (about 2,650). On every one the raw page work was 2.0 to 2.4 times what the index predicts from an Apple M4 Max at about 4,000. A runner at about 3,700 did 2.7 times the Mac's work. #71's index-calibrated gate (9.4x at an index of 2,795) put TBT at 450 to 620 ms.
- **Three causes were ruled out.** Contention: pinning the server, the mock and Chrome made no difference, or made it worse, and the server used under 2.5 s of CPU per collection. AVIF encoding on an image's first request. The missing GPU.
- **Calibrating from a frozen built page works.** The multiplier is `REFERENCE_MS / W`, where W is the host's raw main-thread time on a frozen copy of the built `/`. On two runner types this gave TBT of 96 to 242 ms and performance of 0.95 to 0.98, against the Mac's 87 to 207 ms.
- **Lantern's first round trip is 14,600 bytes.** D6's document-size guard enforces it.
- **The open question.** With an honest constant, are the three image-led pages (`/welcome/`, `/resources/` and `/resources/article/taxonomies-versus-meta/`) over 200 ms TBT on the reference phone? Their main-thread work is mostly React and Next hydration, counted up to an image LCP at about 2.35 s.
  - On the Mac at the branch's `REFERENCE_MS` of 857 ms (15.1x), they measured 204, 201 and 210 ms (performance 0.95, 0.95 and 0.94). The other six pages measured about 101 ms.
  - At the experiment's 800 ms they measured 181 to 190 ms.
  - So the verdict turns on about 7% of the constant, and the constant rests on nine runs from one sitting.

## Restarting

1. **Check that no Lighthouse run is active**, because a concurrent run skews W and every TBT. `ps aux | grep -E 'lighthouse|lhci' | grep -v grep` should print nothing. Pick a free port pair (`lsof -iTCP -sTCP:LISTEN`) and export `RH_WEB_PORT` and `RH_MOCK_CMS_PORT`.

2. **Switch to the branch and rebase it onto `main`.** Replay only the branch's own commits, the ones after c65f34b, so that #71's commits are not replayed onto their own merge:

   ```sh
   git fetch origin
   git switch lhci/snapshot-calibration
   git rebase --onto origin/main c65f34b
   ```

   Expect conflicts in four files. Resolve each one by keeping main's later changes and putting the snapshot calibration back in place of fixed 4x:

   - `apps/web/e2e/lighthouse.mts`
   - `.github/workflows/ci.yml` (the Lighthouse step's comment and timeout)
   - `apps/web/lighthouserc.cjs` (the throttling docblock and `RH_LH_CPU_SLOWDOWN`)
   - `apps/web/e2e/README.md` (main's fixed-4x text, which this work replaces)

   Main dropped `cpu-calibration.mts` and its test when #71 went back to 4x, so git may report them as modify/delete conflicts. Keep the branch's versions. Then run `pnpm web:typecheck`, `pnpm web:lint` and `pnpm web:test`.

3. **Regenerate the calibration page on the rebased build:**

   ```sh
   pnpm --filter resource-hub-web lighthouse:calibration-page
   ```

   This builds the app as the gate does, captures `/` from the cache, and keeps exactly the files the page loads. It then measures the result nine times. Its last lines print the median `benchmarkIndex`, the median raw time and the `DERIVATION` they give. Commit the folder. A snapshot that requests a missing file stops the gate, so regenerate whenever `/`'s build output changes.

4. **Re-derive `REFERENCE_MS` from at least 30 runs over more than one sitting.**
   - **The formula.** `REFERENCE_MS` is the calculator's multiplier for the derivation host's median `benchmarkIndex`, times that host's median raw time W. Both inputs are in `DERIVATION`, in `apps/web/e2e/cpu-calibration.mts`, and the module computes the constant from them.
   - **Where to run it.** Use a host where the calculator is trusted, such as an Apple-silicon laptop on mains power with nothing else running.
   - **How to run it.** The generator rewrites the folder and measures nine runs each time. Run it in at least four sittings, on different days or after a reboot. After each sitting, check that `git status apps/web/e2e/calibration-page` shows no change: the same build gives the same snapshot, so the measurements stay comparable. Record each run's nine indexes and nine times from the printed line.
   - **The value.** Take the median index and the median time over all the runs, not the median of the per-sitting medians. Write them, the date, the host and the run count into `DERIVATION` and its docblock, in the same commit as the folder.
   - **A shortcut.** The generator has no measure-only mode. A small flag that skips the build and the capture and calls `measure()` with a run count from the environment saves the rebuilds, and is worth adding first.

5. **Run the gate and read the table:**

   ```sh
   rm -rf apps/web/.next/cache/images
   pnpm web:test:lighthouse
   ```

   The summary prints W, the multiplier and, for each URL, the median performance, LCP, TBT, raw main-thread time and `benchmarkIndex`. Run it at least twice. A single run near 200 ms proves nothing either way.

## Deciding

- **If the image-led pages pass** at the re-derived constant (TBT at most 200 ms, performance at least 0.95, on two runs locally and on CI): enable the calibrated gate in one PR. That PR rewrites `e2e/README.md`'s Lighthouse section, updates `apps/web/CLAUDE.md` item 4 if its wording changes, adds the derivation's evidence, and links #76. The CI run on the PR is the check on a runner CPU. Its W and multiplier should land near the experiment's: about 3.6x on an EPYC 7763 and about 5x on a Xeon 6975P-C.
- **If they fail**, the finding is the design's to fix. Cut hydration cost on those pages before turning the gate on. Never loosen a budget (`apps/web/CLAUDE.md` item 4).
  - **Ruled out already:** prefetch, which made no difference per 1x of slowdown; contention; AVIF encoding; the GPU.
  - **Confirm the window first.** Read Lighthouse 13.6's Lantern TBT to see which window it counts on these pages. The text-led pages measure about 101 ms with the same scripts, so the difference is the window, not the bundle.
  - **Then the candidates:**
    - Bring the image LCP earlier, so that fewer hydration tasks fall inside the window: the lead image's bytes, its `fetchpriority`, and whether it can be preloaded from the HTML.
    - Shrink what hydrates. The client components are `ThemeToggle`, `ThemeFieldset` and `ListingFocus`; every client component's import graph counts.
    - Look at the largest script in `bootup-time`. It is the same chunk on every host (`0mos3an5a3qx_.js` in the evidence), so check how much of it is the framework and how much is the app.
  - Measure each change with the calibrated gate on the branch. When the pages pass, return to the first branch of this decision.

## Re-running the CI experiment

Use this to check a new runner CPU, or the calibration against a Vercel preview.

1. Make a branch named `experiment/<something>` from `lhci/snapshot-calibration`. Never use `main` or a PR branch.
2. `git mv apps/web/e2e/experiments/lhci-experiment.yml.txt .github/workflows/lhci-experiment.yml`, delete its header note, and set the variants in its `env`. The variants are listed in the docblock of `apps/web/e2e/experiments/lh-experiment.mts`.
   - Set `RH_LHX_SNAP_K` to the current `REFERENCE_MS`. The first runs used 800.
   - For a preview variant (`ext`), set `RH_LHX_EXTERNAL_ORIGIN` to the preview's URL. Set `RH_LHX_EXTRA_HEADERS` to `{"x-vercel-protection-bypass": "${{ secrets.VERCEL_PROTECTION_BYPASS }}"}`. That repository secret exists for exactly this.
3. Push. Every push to `experiment/**` starts one `ubuntu-latest` job of about 15 to 25 minutes, so push only when you want a run. The repository is private, so each run spends CI minutes.
4. Download the report with `gh run download <id>` into a scratch directory, not the repository. Extract the per-URL medians into `apps/web/e2e/experiments/evidence/`, in the same columns as the existing CSVs. The artifact is kept for 7 days.
5. Delete the branch, locally and on the remote, when done.

## A prompt to resume in an agent session

> Resume the calibrated Lighthouse gate for this repository. Read issue #76, then `docs/runbooks/lighthouse-calibration-resume.md` and `apps/web/e2e/experiments/evidence/README.md` on branch `lhci/snapshot-calibration`. Follow the runbook's restart steps in order: rebase the branch's own commits (after c65f34b) onto `origin/main` and resolve the four expected conflicts by keeping main's later changes plus the snapshot calibration. Regenerate the calibration page. Re-derive `REFERENCE_MS` from at least 30 runs over at least four sittings, recording every run. Run `pnpm web:test:lighthouse` twice. Before any Lighthouse run, check that no other Lighthouse run is active, and use a free port pair. Then report the table and follow the runbook's decision. If the three image-led pages pass, prepare one PR enabling the calibrated gate. If they fail, propose hydration cuts for those pages, never a looser budget. Do not push to `main` or merge anything.
