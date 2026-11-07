# mac3: Apple M4 Max, frozen built page

v0, snap, ref, snap again and v0 again, as ci3.

CPU: Apple M4 Max. Medians of 3 runs per URL; raw main thread is the diagnostics audit's observed totalTaskTime, before any multiplier.

| Variant | Calibration index | Index × | W ref (ms) | W snapshot (ms) | × used | URL | TBT (ms) | LCP (ms) | Perf | Raw main thread (ms) |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| v0 | 3792 | 13.7 | 79 | 58 | 13.7 | / | 90 | 643 | 1.00 | 56 |
|  |  |  |  |  |  | /resources/ | 191 | 2367 | 0.95 | 65 |
|  |  |  |  |  |  | article | 178 | 2331 | 0.96 | 64 |
| snap | 3962 | 14.4 | 71 | 56 | 14.3 | / | 177 | 2330 | 0.96 | 57 |
|  |  |  |  |  |  | /resources/ | 186 | 2339 | 0.95 | 66 |
|  |  |  |  |  |  | article | 190 | 2342 | 0.95 | 64 |
| ref | 4113 | 15.1 | 76 | 53 | 13.7 | / | 87 | 641 | 1.00 | 58 |
|  |  |  |  |  |  | /resources/ | 176 | 2329 | 0.96 | 65 |
|  |  |  |  |  |  | article | 175 | 2328 | 0.96 | 65 |
| snap.again | 4108 | 15 | 77 | 57 | 14.1 | / | 94 | 645 | 0.99 | 58 |
|  |  |  |  |  |  | /resources/ | 181 | 2334 | 0.96 | 65 |
|  |  |  |  |  |  | article | 185 | 2337 | 0.96 | 66 |
| v0.again | 3997 | 14.6 | 73 | 57 | 14.6 | / | 106 | 650 | 0.99 | 60 |
|  |  |  |  |  |  | /resources/ | 193 | 2346 | 0.95 | 66 |
|  |  |  |  |  |  | article | 190 | 2342 | 0.95 | 63 |
