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
 * page's TBT therefore tracks the runner rather than the code: on the same
 * day GitHub's runners reported a `benchmarkIndex` of 1,942 to 2,209 for one
 * pull request's gate and 2,870 to 3,840 for the next one up the stack, and
 * TBT at 4x followed them.
 *
 * The method is the one that page documents: measure the host's
 * `benchmarkIndex` (Lighthouse's "CPU/Memory Power", computed in the page by
 * `computeBenchmarkIndex` in `core/lib/page-functions.js` on every run) and
 * take the multiplier from the Lighthouse CPU slowdown calculator it links,
 * https://lighthouse-cpu-throttling-calculator.vercel.app/. `multiplierFor`
 * is that calculator's formula, copied from its page bundle
 * (`pages/index-aa3a827a64f39d8cb4a3.js`, read 2026-11-06): piecewise linear
 * in the index, 1x at 150, 2x at 800, 3x at 1,300 and a further 1x per 233
 * above that. Its target, the device it is 1x on, is Lighthouse's reference
 * mobile device: the page's "Mid-Tier Mobile" class, whose example device is
 * the Moto G4, the "mid-tier ~$200 phone" Lighthouse's readme says its
 * mobile numbers represent. Below an index of 150 the calculator refuses
 * ("This device is too slow to accurately emulate the target Lighthouse
 * device."), and so does this.
 *
 * The bounds are the calculator's floor and the largest multiplier the same
 * page's table gives for any host and target (20x, a high-end desktop
 * emulating a low-end phone): outside them the host is not one the method
 * covers, so the run stops rather than guess. On this formula 20x is an index
 * of about 5,260.
 */

/** What the calibrated runs simulate, for the summary's heading. */
export const REFERENCE_DEVICE =
  "Lighthouse's mid-tier mobile reference (Moto G4 class), the device the CPU slowdown calculator is 1x on";

/** The formula, for the summary's heading. */
export const FORMULA =
  "Lighthouse's CPU slowdown calculator: 1 + (i − 150) / 650 from i = 150, 2 + (i − 800) / 500 from 800, 3 + (i − 1300) / 233 from 1300, for benchmarkIndex i";

/** The smallest multiplier the calibration accepts: the calculator's own floor (an index of 150). */
export const MIN_MULTIPLIER = 1;

/** The largest multiplier the calibration accepts: the most `docs/throttling.md`'s table gives. */
export const MAX_MULTIPLIER = 20;

/**
 * The calculator's best estimate of the multiplier for a host with this
 * `benchmarkIndex`, unrounded, or `null` where it refuses (below 150, or not
 * a finite number).
 */
export function multiplierFor(benchmarkIndex: number): number | null {
  if (!Number.isFinite(benchmarkIndex)) return null;
  if (benchmarkIndex >= 1300) return 3 + (benchmarkIndex - 1300) / 233;
  if (benchmarkIndex >= 800) return 2 + (benchmarkIndex - 800) / 500;
  if (benchmarkIndex >= 150) return 1 + (benchmarkIndex - 150) / 650;
  return null;
}

/**
 * The multiplier the gate runs with: the calculator's, rounded to one
 * decimal as the calculator prints it. Throws, naming the index and the
 * bounds, when the calculator refuses or the result is outside them.
 */
export function calibratedSlowdown(benchmarkIndex: number): number {
  const raw = multiplierFor(benchmarkIndex);
  const rounded = raw === null ? null : Math.round(raw * 10) / 10;
  if (rounded === null || rounded < MIN_MULTIPLIER || rounded > MAX_MULTIPLIER) {
    throw new Error(
      `This host's Lighthouse benchmarkIndex is ${benchmarkIndex}, which calibrates to ${raw === null ? "no multiplier (the calculator refuses an index below 150)" : `${raw.toFixed(1)}x`}; ` +
        `the gate accepts ${MIN_MULTIPLIER}x to ${MAX_MULTIPLIER}x (an index of 150 to about 5,260). ` +
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
