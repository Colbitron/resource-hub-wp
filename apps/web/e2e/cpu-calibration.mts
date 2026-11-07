/**
 * The CPU slowdown Lighthouse simulates, calibrated to the host it runs on,
 * so every gate run simulates the same phone whatever machine runs it.
 *
 * Lighthouse's simulated throttling multiplies the host's own task times by
 * `throttling.cpuSlowdownMultiplier` (4 by default). That constant is right
 * only for one class of host: "a constant 4x CPU multiplier which moves a
 * typical run in the high-end desktop bracket somewhere into the mid-tier
 * mobile bracket" (Lighthouse's `docs/throttling.md`, "Calibrating the CPU
 * slowdown", at the v13.6.0 tag the installed `lighthouse` is). The same
 * page's TBT therefore tracks the runner rather than the code.
 *
 * The method: measure the host on the work a page load does. Before the
 * gate's runs, `lighthouse.mts` loads the calibration page three times,
 * performance only: a frozen copy of the built `/`, its HTML and the static
 * files it loads (`calibration-page/`, served by `calibration-page.mts`).
 * W is the median of the runs' raw main-thread task time (the `diagnostics`
 * audit's `totalTaskTime`, which Lighthouse observes rather than simulates),
 * and the multiplier is `REFERENCE_MS / W`, rounded to one decimal:
 * `REFERENCE_MS` is the time the same page's main-thread work is taken to
 * take on the reference device, so every host is slowed to it.
 *
 * Why not Lighthouse's documented method, the host's `benchmarkIndex` put
 * through the Lighthouse CPU slowdown calculator
 * (https://lighthouse-cpu-throttling-calculator.vercel.app/), which this
 * gate first used: on 2026-11-06 and 07, across four GitHub runner CPU
 * types, the index did not predict this site's main-thread work. A runner
 * with an index of about 3,700 did 2.7x the raw page work of an Apple M4 Max
 * at about 4,000, so the calculator over-throttled the cloud CPUs and TBT
 * at its multiplier failed pages a laptop passed. Contention from the server
 * or the mock, AVIF encoding and the GPU were ruled out. Calibrating on the
 * snapshot instead put the runners' TBT medians at 96 to 242 ms and
 * performance at 0.95 to 0.98, against the laptop's 87 to 207 ms and 0.95 to
 * 1.00. The index is still read and printed, for information only.
 *
 * `REFERENCE_MS` is derived once, on a host where the calculator is trusted
 * (a high-end desktop, the bracket its 4x default describes), as that host's
 * calculator multiplier times its own W: `DERIVATION` records the inputs,
 * and `multiplierFor` is the calculator's formula, copied from its page
 * bundle (`pages/index-aa3a827a64f39d8cb4a3.js`, read 2026-11-06): piecewise
 * linear in the index, 1x at 150, 2x at 800, 3x at 1,300 and a further 1x
 * per 233 above that. Its target, the device it is 1x on, is Lighthouse's
 * reference mobile device: the page's "Mid-Tier Mobile" class, whose
 * example device is the Moto G4, the "mid-tier ~$200 phone" Lighthouse's
 * readme says its mobile numbers represent.
 *
 * The snapshot and the constant are one calibration. Whoever regenerates
 * `calibration-page/` (`write-calibration-page.mts`, which prints the new
 * measurement) recomputes `DERIVATION` in the same commit, on the host it
 * names or one of its class; a snapshot with a stale constant would move
 * every page's TBT by the ratio of the two pages' work.
 *
 * The bounds are 1x, a host as slow as the reference device, and 20x, the
 * largest multiplier `docs/throttling.md`'s table gives for any host and
 * target (a high-end desktop emulating a low-end phone): outside them the
 * host is not one the method covers, so the run stops rather than guess.
 */

/** What the calibrated runs simulate, for the summary's heading. */
export const REFERENCE_DEVICE = "Lighthouse's mid-tier mobile reference (Moto G4 class)";

/**
 * The measurement `REFERENCE_MS` comes from: the median `benchmarkIndex` and
 * raw main-thread time (ms) of nine Lighthouse runs of the calibration page,
 * performance only, as `write-calibration-page.mts` prints them. On
 * 2026-11-07 the nine indexes were 3,923 to 4,269 and the times 53.5 to
 * 58.0 ms, so REFERENCE_MS = 15.09 × 56.8 = 857 ms.
 */
export const DERIVATION = {
  host: "an Apple M4 Max (16 cores) on macOS 26.6.2",
  date: "2026-11-07",
  benchmarkIndex: 4117,
  rawMs: 56.8,
} as const;

/**
 * The calculator's best estimate of the multiplier for a host with this
 * `benchmarkIndex`, unrounded, or `null` where it refuses (below 150, or not
 * a finite number). Used for the derivation and for reporting; it never sets
 * a gate run's multiplier.
 */
export function multiplierFor(benchmarkIndex: number): number | null {
  if (!Number.isFinite(benchmarkIndex)) return null;
  if (benchmarkIndex >= 1300) return 3 + (benchmarkIndex - 1300) / 233;
  if (benchmarkIndex >= 800) return 2 + (benchmarkIndex - 800) / 500;
  if (benchmarkIndex >= 150) return 1 + (benchmarkIndex - 150) / 650;
  return null;
}

/**
 * The calibration page's main-thread time on the reference device, in ms:
 * the derivation host's calculator multiplier times its raw time, rounded.
 */
export const REFERENCE_MS = Math.round((multiplierFor(DERIVATION.benchmarkIndex) ?? Number.NaN) * DERIVATION.rawMs);

/** The formula, for the summary's heading. */
export const FORMULA = `REFERENCE_MS / W, rounded to one decimal, where W is this host's median raw main-thread time on the calibration page and REFERENCE_MS is ${REFERENCE_MS} ms: the CPU slowdown calculator's ${multiplierFor(DERIVATION.benchmarkIndex)?.toFixed(2)}x for the benchmarkIndex of ${DERIVATION.benchmarkIndex} measured on ${DERIVATION.host}, times that host's ${DERIVATION.rawMs} ms`;

/** The smallest multiplier the calibration accepts: a host as slow as the reference device. */
export const MIN_MULTIPLIER = 1;

/** The largest multiplier the calibration accepts: the most `docs/throttling.md`'s table gives. */
export const MAX_MULTIPLIER = 20;

/**
 * The multiplier the gate runs with for a host whose median raw main-thread
 * time on the calibration page is `rawMs`: `REFERENCE_MS / rawMs`, rounded
 * to one decimal. Throws, naming the time and the range, when it is not a
 * positive number or the multiplier is outside the bounds.
 */
export function calibratedSlowdown(rawMs: number): number {
  const rounded = Number.isFinite(rawMs) && rawMs > 0 ? Math.round((REFERENCE_MS / rawMs) * 10) / 10 : null;
  if (rounded === null || rounded < MIN_MULTIPLIER || rounded > MAX_MULTIPLIER) {
    throw new Error(
      `This host's raw main-thread time on the calibration page is ${rawMs} ms, which calibrates to ${rounded === null ? "no multiplier" : `${rounded}x`}; ` +
        `the gate accepts ${MIN_MULTIPLIER}x to ${MAX_MULTIPLIER}x (about ${Math.round(REFERENCE_MS / MAX_MULTIPLIER)} to ${REFERENCE_MS} ms, against a reference of ${REFERENCE_MS} ms). ` +
        "Its TBT would not be comparable with other runs; run it on a host inside that range.",
    );
  }
  return rounded;
}

/**
 * Reads the multiplier `lighthouse.mts` passes to `lighthouserc.cjs` in
 * `RH_LH_CPU_SLOWDOWN`, or `undefined` when it is unset. Throws on a value
 * that is not a number inside the bounds, so a mistyped override never
 * reaches Lighthouse.
 */
export function slowdownFromEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const raw = env.RH_LH_CPU_SLOWDOWN;
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw) || value < MIN_MULTIPLIER || value > MAX_MULTIPLIER) {
    throw new Error(`RH_LH_CPU_SLOWDOWN must be a number from ${MIN_MULTIPLIER} to ${MAX_MULTIPLIER}, not "${raw}".`);
  }
  return value;
}
