# mac1: Apple M4 Max, contention variants

The same variants as ci1 where they apply on macOS (v0, v2, v4, v0 again; no taskset). Run locally on 2026-11-06 with the experiment's build.

CPU: Apple M4 Max. Medians of 3 runs per URL; raw main thread is the diagnostics audit's observed totalTaskTime, before any multiplier.

| Variant | Calibration index | Index × | W ref (ms) | W snapshot (ms) | × used | URL | TBT (ms) | LCP (ms) | Perf | Raw main thread (ms) |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| v0 | 4073 | 14.9 | – | – | 14.9 | / | 99 | 645 | 0.99 | 57 |
|  |  |  |  |  |  | /resources/ | 203 | 2356 | 0.95 | 63 |
|  |  |  |  |  |  | article | 207 | 2360 | 0.95 | 65 |
| v2 | 4124 | 15.1 | – | – | 15.1 | / | 100 | 645 | 0.99 | 56 |
|  |  |  |  |  |  | /resources/ | 192 | 2346 | 0.95 | 61 |
|  |  |  |  |  |  | article | 194 | 2347 | 0.95 | 63 |
| v4 | 4080 | 14.9 | – | – | 14.9 | / | 93 | 644 | 0.99 | 52 |
|  |  |  |  |  |  | /resources/ | 188 | 2342 | 0.95 | 60 |
|  |  |  |  |  |  | article | 188 | 2340 | 0.95 | 59 |
| v0.again | 3945 | 14.4 | – | – | 14.4 | / | 105 | 644 | 0.99 | 56 |
|  |  |  |  |  |  | /resources/ | 195 | 2348 | 0.95 | 64 |
|  |  |  |  |  |  | article | 194 | 2347 | 0.95 | 65 |
