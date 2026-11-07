# Lighthouse calibration evidence, 2026-11-06 and 07

The numbers behind `lhci/snapshot-calibration`, extracted from the reports so they outlive the CI artifacts (kept 7 days). The full HTML and JSON reports are not committed. Each run has a `.md` table and a `.csv` of the same numbers. The procedure for resuming is `docs/runbooks/lighthouse-calibration-resume.md`.

Every set measured the same three URLs from one build of D5 (c65f34b plus the experiment's runner): `/`, `/resources/` and `/resources/article/taxonomies-versus-meta/` ("article"). Medians are of 3 runs per URL unless a table says otherwise. Raw main thread is the `diagnostics` audit's `totalTaskTime`, which Lighthouse observes before any multiplier, so it compares hosts directly.

## The runs

| Set | Where | Commit | CPU | Variants |
|---|---|---|---|---|
| [ci1](ci1-42347089074.md) | GitHub run 42347089074 | cc7d2a5 | AMD EPYC 9V45 | v0, v1, v1s, v2, v12, v4, v0 again |
| [ci2](ci2-42349175405.md) | GitHub run 42349175405 | 6712763 | AMD EPYC 9V74 | v0, ref, v1s, ref again, v0 again |
| [ci3](ci3-42350517729.md) | GitHub run 42350517729 | 7e9cfe0 | AMD EPYC 7763 | v0, snap, ref, snap again, v0 again |
| [ci4](ci4-42352034010.md) | GitHub run 42352034010 | be1bb79 | Intel Xeon 6975P-C | snap, v0, snap again |
| [mac1](mac1.md) | local | cc7d2a5 | Apple M4 Max | v0, v2, v4, v0 again |
| [mac2](mac2.md) | local | 6712763 | Apple M4 Max | v0, ref, v0 again |
| [mac3](mac3.md) | local | 7e9cfe0 | Apple M4 Max | v0, snap, ref, snap again, v0 again |
| [docker](docker.csv) | local, Playwright's Linux image | 6712763 to 7e9cfe0 | Apple M4 Max, 2 or 8 CPUs | the three pages at a fixed 14.4x |
| [pr71](pr71.csv) | GitHub run 42345088845 (#71's gate) | c65f34b | not recorded | the gate's nine URLs, 5 runs each |

All GitHub runners were `ubuntu-latest` with 2 CPUs.

The variants (the docblock of `../lh-experiment.mts` has the full list):

- **v0**: the gate as in #71. Unpinned, HTML-only warm-up, image cache cold, multiplier from the CPU slowdown calculator on the median `benchmarkIndex`.
- **v1**, **v1s**, **v12**: the server and the mock pinned to CPU 0 with `taskset`; Chrome pinned to CPU 1 (v1, v12) or left free (v1s). v12 adds v2's warm-up.
- **v2**: a full warm-up of every page and every optimiser image URL, then a wait for the server to go idle.
- **v4**: v2 with Chrome's `--disable-gpu`.
- **ref**: the multiplier is `RH_LHX_REF_K` (1040) over the host's raw time on a synthetic workload (`../lhx-reference.mts`).
- **snap**: the multiplier is `RH_LHX_SNAP_K` (800) over the host's raw time W on the frozen built `/`. The branch's gate uses the same method with `REFERENCE_MS` = 857, so its multipliers are about 7% higher than the experiment's.

## What the index predicted against what the page did

`benchmarkIndex` is meant to scale inversely with page work. If it did, a host's raw work on `/` would be about the Mac's 57 ms times 4,000 over its index. v0's raw main thread on `/`, against that prediction:

| Host | Median index | Predicted raw on / (ms) | Measured raw on / (ms) | Measured over predicted | Measured over Mac | W snapshot (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Apple M4 Max | about 4,000 | 57 | 56 to 60 | 1.0x | 1.0x | 56 to 57 |
| EPYC 9V45 | about 3,700 | 62 | 151 to 153 | 2.4x | 2.7x | not measured |
| Xeon 6975P-C | about 2,650 | 86 | 170 | 2.0x | 3.0x | 159 to 166 |
| EPYC 9V74 | about 2,400 | 95 | 185 to 189 | 2.0x | 3.3x | not measured |
| EPYC 7763 | about 1,850 | 123 | 250 to 261 | 2.1x | 4.5x | 223 to 242 |
| Linux Chromium in Docker on the Mac, 2 CPUs | about 3,900 | 58 | 93 | 1.6x | 1.6x | not measured |

The index ranks the runners in roughly the right order but understates the page work on every Linux host against the Mac, by 1.6x (Docker) to 2.4x (EPYC 9V45), and by a different factor on each. So the calculator over-throttles the runners, and TBT at its multiplier fails pages the Mac passes. The snapshot's W tracks the page's raw time on every host where both were measured.

## Calibrated outcomes

TBT (ms) and performance per page, by method. The "index" rows are v0 at the calculator's multiplier; the "snapshot" rows are snap at 800 / W.

| Host | Method | × | / | /resources/ | article |
|---|---|---:|---|---|---|
| EPYC 7763 (ci3) | index | 5.5 | 409, 0.90 | 408, 0.88 | 302, 0.93 |
| EPYC 7763 (ci3) | snapshot | 3.4 | 204, 0.97 | 191, 0.96 | 179, 0.97 |
| EPYC 7763 (ci3) | snapshot again | 3.6 | 176, 0.98 | 194, 0.95 | 151, 0.96 |
| Xeon 6975P-C (ci4) | index | 8.9 | 407, 0.90 | 373, 0.89 | 325, 0.92 |
| Xeon 6975P-C (ci4) | snapshot | 5.0 | 187, 0.97 | 242, 0.95 | 137, 0.97 |
| Xeon 6975P-C (ci4) | snapshot again | 4.8 | 212, 0.96 | 117, 0.98 | 96, 0.98 |
| Apple M4 Max (mac3) | index | 13.7 | 90, 1.00 | 191, 0.95 | 178, 0.96 |
| Apple M4 Max (mac3) | snapshot | 14.3 | 177, 0.96 | 186, 0.95 | 190, 0.95 |
| Apple M4 Max (mac3) | snapshot again | 14.1 | 94, 0.99 | 181, 0.96 | 185, 0.96 |

The Mac's `/` is bimodal: its LCP is either the text (about 645 ms, TBT about 90) or an image (about 2,330 ms, TBT about 180), and TBT counts up to LCP.

## Ruled out

- **Contention** (ci1, ci2): pinning the server and the mock away from Chrome (v1s) changed nothing, and pinning Chrome to one CPU (v1, v12) made TBT worse. The server's whole process tree used 1.5 to 2.5 s of CPU per collection of nine loads (ci2 to ci4), and the mock 10 to 30 ms.
- **AVIF encoding on first request** (ci1, mac1): v2's full warm-up, with every optimiser image fetched first, left TBT within the spread between v0 and v0 again on both hosts, and nowhere near the Mac's on the runner.
- **No GPU** (ci1, mac1): v4's `--disable-gpu` did the same.

## #71's gate (pr71.csv)

Run 42345088845, the index-calibrated gate on c65f34b, 5 runs per URL: index 2,671 to 2,805 (the calibration's median 2,795, so 9.4x), TBT 453 to 624 ms and performance 0.83 to 0.89 on all nine URLs, raw main thread 163 to 225 ms. The same commit on the Mac at its index's 15.1x is in the runbook.

## Docker on the Mac (docker.csv)

Playwright's Linux image (`mcr.microsoft.com/playwright`, arm64 Chromium) on the Mac, `--cpuset-cpus` 0-1 and 0-7, every run at 14.4x, run by `in-container.sh` against the host's server:

- `cpus0_1` and `cpus0_7`: the three pages. With 2 CPUs the raw main thread was 93 to 103 ms, 1.6x the native Mac's at the same index; with 8 CPUs, 68 to 83 ms.
- `ref0_1`, `ref0_7`, `refmac`: the synthetic reference workload at 2 CPUs, 8 CPUs and natively, raw 79, 67 and 71 ms. The synthetic workload hardly separated the hosts that the page separated, which is why it was dropped for the snapshot.
- `snapmac`: the snapshot natively, 5 runs, raw 55 ms.
