# mac2: Apple M4 Max, synthetic reference workload

v0, ref and v0 again, as ci2.

CPU: Apple M4 Max. Medians of 3 runs per URL; raw main thread is the diagnostics audit's observed totalTaskTime, before any multiplier.

| Variant | Calibration index | Index × | W ref (ms) | W snapshot (ms) | × used | URL | TBT (ms) | LCP (ms) | Perf | Raw main thread (ms) |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| v0 | 4089 | 15 | 73 | – | 15 | / | 191 | 2344 | 0.95 | 57 |
|  |  |  |  |  |  | /resources/ | 201 | 2355 | 0.95 | 67 |
|  |  |  |  |  |  | article | 202 | 2355 | 0.95 | 64 |
| ref | 4008 | 14.6 | 75 | – | 13.9 | / | 92 | 646 | 1.00 | 59 |
|  |  |  |  |  |  | /resources/ | 187 | 2340 | 0.95 | 65 |
|  |  |  |  |  |  | article | 189 | 2341 | 0.95 | 65 |
| v0.again | 4122 | 15.1 | 70 | – | 15.1 | / | 101 | 645 | 0.99 | 59 |
|  |  |  |  |  |  | /resources/ | 204 | 2358 | 0.95 | 64 |
|  |  |  |  |  |  | article | 222 | 2375 | 0.94 | 67 |
