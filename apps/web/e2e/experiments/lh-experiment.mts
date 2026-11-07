/**
 * THROWAWAY EXPERIMENT (first run on branch experiment/lhci-contention at
 * be1bb79, kept on lhci/snapshot-calibration for a re-run), not part of the
 * gate. Runs the calibrated Lighthouse step under several variants on one
 * build, one after another on the same host, and prints per variant the
 * calibration, the medians and the raw main-thread breakdowns, so the host's
 * own task times can be compared between a Mac and a CI runner.
 *
 *   RH_LHX_VARIANTS=v0,v1,v2 RH_E2E_PREBUILT=1 node e2e/experiments/lh-experiment.mts
 *
 * Variants (comma list, run in order; any name may repeat with a suffix
 * after a dot, e.g. v0.again):
 *   v0   the gate as in #71: unpinned, HTML-only warm-up, image cache cold.
 *   v1   server and mock on CPU 0, Chrome on CPU 1 (Linux, taskset).
 *   v1s  server and mock on CPU 0, Chrome unrestricted.
 *   v2   full warm-up: every page, every optimiser image URL the pages name,
 *        then wait for the server to go idle.
 *   v12  v1 + v2.
 *   v4   v2 + Chrome --disable-gpu.
 *   v4b  v2 + Chrome --enable-gpu-rasterization --ignore-gpu-blocklist.
 *   v4c  v2 + Chrome --disable-gpu --disable-gpu-compositing --disable-software-rasterizer.
 *   snap v0, but the multiplier is RH_LHX_SNAP_K / the host's raw main-thread
 *        ms for the frozen built page (../calibration-page/).
 *   ref  v0, but the multiplier is RH_LHX_REF_K / the host's raw main-thread
 *        ms for the reference workload (lhx-reference.mts), not benchmarkIndex.
 *   ext  no server on the host: measure RH_LHX_EXTERNAL_ORIGIN (with
 *        RH_LHX_EXTRA_HEADERS as JSON), the paths of RH_LHX_PATHS.
 *
 * RH_LHX_PATHS (comma list) picks the URLs, RH_LHX_RUNS the runs per URL,
 * RH_LHX_OUT the directory each variant's raw reports are copied to.
 *
 * Moved from e2e/ on be1bb79: the imports and APP_DIR now reach one level
 * further up, the index multiplier is computed here (the gate's
 * calibratedSlowdown now takes a raw time, not an index), and the snapshot
 * lhx-reference.mts serves is ../calibration-page/, the gate's successor to
 * be1bb79's lhx-snapshot/ (the same built "/", with the CSS inlined).
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { assertPrebuilt, writeBuildStamp } from "../build-stamp.mts";
import { appServerEnv, appSiteOrigin, mockCmsOrigin, mockCmsPort, prebuilt, webPort } from "../mock-cms/config.mts";
import { multiplierFor } from "../cpu-calibration.mts";
import { median } from "../lighthouse-summary.mts";
import { startReferenceServer } from "./lhx-reference.mts";

const APP_DIR = new URL("../..", import.meta.url).pathname;

/** The CPU slowdown calculator's multiplier for an index, rounded to one decimal, as #71's gate used it. */
function calibratedSlowdown(benchmarkIndex: number): number {
  const raw = multiplierFor(benchmarkIndex);
  if (raw === null) throw new Error(`The calculator refuses a benchmarkIndex of ${benchmarkIndex}.`);
  return Math.round(raw * 10) / 10;
}
const RAW_DIR = join(APP_DIR, ".lighthouseci");
const OUT_DIR = process.env.RH_LHX_OUT ?? join(APP_DIR, "lhx-results");
const LINUX = platform() === "linux";
const require = createRequire(import.meta.url);
const CHROME: string = require("@playwright/test").chromium.executablePath();
const BASE_FLAGS = "--headless=new --no-sandbox";

const PATHS = (process.env.RH_LHX_PATHS ?? "/,/resources/,/resources/article/taxonomies-versus-meta/").split(",");
const RUNS = Number(process.env.RH_LHX_RUNS ?? "3");
const CALIBRATION_RUNS = 3;
const REF_PORT = Number(process.env.RH_LHX_REF_PORT ?? webPort() + 7);
const REF_ORIGIN = `http://127.0.0.1:${REF_PORT}`;

interface Variant {
  name: string;
  pinServer: boolean;
  pinChrome: boolean;
  fullWarm: boolean;
  extraFlags: string;
  external: boolean;
  refCalibrated: boolean;
  snapCalibrated: boolean;
}

function variantFor(spec: string): Variant {
  const base = spec.split(".")[0];
  const v: Variant = { name: spec, pinServer: false, pinChrome: false, fullWarm: false, extraFlags: "", external: false, refCalibrated: false, snapCalibrated: false };
  switch (base) {
    case "v0":
      break;
    case "v1":
      v.pinServer = v.pinChrome = true;
      break;
    case "v1s":
      v.pinServer = true;
      break;
    case "v2":
      v.fullWarm = true;
      break;
    case "v12":
      v.pinServer = v.pinChrome = v.fullWarm = true;
      break;
    case "v4":
      v.fullWarm = true;
      v.extraFlags = "--disable-gpu";
      break;
    case "v4b":
      v.fullWarm = true;
      v.extraFlags = "--enable-gpu-rasterization --ignore-gpu-blocklist";
      break;
    case "v4c":
      v.fullWarm = true;
      v.extraFlags = "--disable-gpu --disable-gpu-compositing --disable-software-rasterizer";
      break;
    case "ref":
      v.refCalibrated = true;
      break;
    case "snap":
      v.snapCalibrated = true;
      break;
    case "ext":
      v.external = true;
      break;
    default:
      throw new Error(`Unknown variant ${spec}`);
  }
  if ((v.pinServer || v.pinChrome) && !LINUX) throw new Error(`${spec} pins CPUs, which needs Linux's taskset.`);
  return v;
}

const children: ChildProcess[] = [];

function startServer(command: string[], env: Record<string, string>, cpu: string | null): ChildProcess {
  const [cmd, ...args] = cpu === null ? command : ["taskset", "-c", cpu, ...command];
  const child = spawn(cmd, args, { cwd: APP_DIR, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env }, detached: true });
  children.push(child);
  return child;
}

function stopServers(): void {
  for (const child of children.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // gone
      }
    }
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(url: string, server: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`server for ${url} exited`);
    if (await answers(url)) return;
    await sleep(250);
  }
  throw new Error(`${url} did not answer`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Proc { pid: number; ppid: number; cpuMs: number; comm: string; allowed: string }

/** Every live process with its parent, CPU ms so far and (Linux) allowed CPUs. */
function processes(withAffinity = false): Proc[] {
  if (LINUX) {
    const out: Proc[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        const comm = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
        const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        let allowed = "";
        if (withAffinity) allowed = /Cpus_allowed_list:\s*(\S+)/.exec(readFileSync(`/proc/${entry}/status`, "utf8"))?.[1] ?? "?";
        out.push({ pid: Number(entry), ppid: Number(rest[1]), cpuMs: (Number(rest[11]) + Number(rest[12])) * 10, comm, allowed });
      } catch {
        // exited
      }
    }
    return out;
  }
  const text = spawnSync("ps", ["-A", "-o", "pid=,ppid=,time=,comm="], { encoding: "utf8" }).stdout;
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pid, ppid, t, ...comm] = line.trim().split(/\s+/);
      let sec = 0;
      for (const part of t.split(":").map(Number)) sec = sec * 60 + part;
      return { pid: Number(pid), ppid: Number(ppid), cpuMs: sec * 1000, comm: comm.join(" "), allowed: "" };
    });
}

/** The process `root` and every descendant of it. */
function tree(root: number, procs: Proc[]): Proc[] {
  const keep = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (!keep.has(p.pid) && keep.has(p.ppid)) {
        keep.add(p.pid);
        grew = true;
      }
    }
  }
  return procs.filter((p) => keep.has(p.pid));
}

/** CPU ms (user + system) used so far by a process and its live descendants. */
function groupCpuMs(root: number): number {
  return tree(root, processes()).reduce((sum, p) => sum + p.cpuMs, 0);
}

function systemBusyMs(): number {
  return cpus().reduce((sum, c) => sum + c.times.user + c.times.nice + c.times.sys + c.times.irq, 0);
}

/** Linux: the CPU affinity of every chrome and server process seen while sampling, and chrome's CPU time. */
class ChromeSampler {
  private timer: NodeJS.Timeout | null = null;
  readonly affinity = new Map<string, number>();
  readonly cpuTicks = new Map<number, number>();
  readonly serverAffinity = new Map<string, number>();
  private readonly serverRoots: number[];
  constructor(serverRoots: number[]) {
    this.serverRoots = serverRoots;
  }
  start(): void {
    if (!LINUX) return;
    this.timer = setInterval(() => this.sample(), 250);
  }
  private sample(): void {
    const procs = processes(true);
    const server = new Set(this.serverRoots.flatMap((r) => tree(r, procs).map((p) => p.pid)));
    for (const p of procs) {
      const isChrome = /chrom/i.test(p.comm);
      if (server.has(p.pid)) {
        const key = `${p.comm}:${p.allowed}`;
        this.serverAffinity.set(key, (this.serverAffinity.get(key) ?? 0) + 1);
      } else if (isChrome) {
        this.affinity.set(p.allowed, (this.affinity.get(p.allowed) ?? 0) + 1);
        this.cpuTicks.set(p.pid, p.cpuMs);
      }
    }
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
  chromeCpuMs(): number {
    return [...this.cpuTicks.values()].reduce((a, b) => a + b, 0);
  }
}

function runAsync(command: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

interface AnyLhr {
  requestedUrl: string;
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { numericValue?: number; details?: { items?: Array<Record<string, unknown>> } }>;
  environment?: { benchmarkIndex?: number };
  configSettings?: { throttling?: { cpuSlowdownMultiplier?: number } };
}

function rawRuns(): AnyLhr[] {
  if (!existsSync(RAW_DIR)) return [];
  return readdirSync(RAW_DIR)
    .filter((n) => /^lhr-.*\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(join(RAW_DIR, n), "utf8")) as AnyLhr);
}

function chromeWrapper(v: Variant): string {
  if (!v.pinChrome) return CHROME;
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), "lhx-chrome");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "chrome-cpu1.sh");
  writeFileSync(path, `#!/bin/sh\nexec taskset -c 1 "${CHROME}" "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

function collectArgs(v: Variant, urls: string[], runs: number, extra: string[] = []): string[] {
  const flags = [BASE_FLAGS, v.extraFlags].filter(Boolean).join(" ");
  const args = ["exec", "lhci", "collect", "--config=./lighthouserc.cjs", ...urls.map((u) => `--url=${u}`), `--numberOfRuns=${runs}`, `--chromePath=${chromeWrapper(v)}`, `--settings.chromeFlags=${flags}`, ...extra];
  const headers = process.env.RH_LHX_EXTRA_HEADERS;
  if (v.external && headers) args.push(`--settings.extraHeaders=${headers}`);
  return args;
}

/** Every optimiser URL a page's HTML names, in src and srcset. */
function imageUrls(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\/_next\/image\/?\?[^"'\s,]+/g)) found.add(m[0].replaceAll("&amp;", "&"));
  return [...found];
}

async function waitIdle(pgids: number[], label: string): Promise<void> {
  const start = Date.now();
  let last = pgids.reduce((s, g) => s + groupCpuMs(g), 0);
  let quiet = 0;
  while (Date.now() - start < 60_000) {
    await sleep(1000);
    const now = pgids.reduce((s, g) => s + groupCpuMs(g), 0);
    if (now - last <= 20) quiet += 1;
    else quiet = 0;
    last = now;
    if (quiet >= 2) break;
  }
  console.log(`[lhx] ${label}: servers idle after ${Math.round((Date.now() - start) / 1000)} s`);
}

interface VariantResult {
  name: string;
  calibration: number[];
  indexMultiplier: number;
  refMs: number[];
  snapMs: number[];
  multiplier: number;
  runs: AnyLhr[];
  serverCpuMs: number;
  mockCpuMs: number;
  chromeCpuMs: number;
  systemBusyMs: number;
  wallMs: number;
  chromeAffinity: string;
  serverAffinity: string;
  imagesWarmed: number;
  allUsedMultiplier: boolean;
}

async function runVariant(v: Variant): Promise<VariantResult> {
  console.log(`\n========== [lhx] variant ${v.name} ${JSON.stringify(v)} ==========\n`);
  const origin = v.external ? (process.env.RH_LHX_EXTERNAL_ORIGIN ?? "") : appSiteOrigin();
  if (!origin) throw new Error("ext needs RH_LHX_EXTERNAL_ORIGIN");
  const urls = PATHS.map((p) => `${origin}${p}`);
  const pgids: number[] = [];
  let imagesWarmed = 0;
  if (!v.external) {
    rmSync(join(APP_DIR, ".next/cache/images"), { recursive: true, force: true });
    rmSync(join(APP_DIR, ".next/cache/fetch-cache"), { recursive: true, force: true });
    const cpu = v.pinServer ? "0" : null;
    const mock = startServer(["node", "e2e/mock-cms/main.mts"], { RH_MOCK_CMS_PORT: String(mockCmsPort()) }, cpu);
    await waitFor(`${mockCmsOrigin()}/__mock/health`, mock, 15_000);
    const app = startServer(["pnpm", "exec", "next", "start", "--port", String(webPort())], appServerEnv(), cpu);
    await waitFor(`${origin}/`, app, 60_000);
    pgids.push(app.pid!, mock.pid!);
    // The gate's warm-up: one request per measured URL.
    for (const url of urls) {
      const r = await fetch(url);
      const html = await r.text();
      if (!r.ok) throw new Error(`${url} ${r.status}`);
      if (v.fullWarm) {
        for (const img of imageUrls(html)) {
          const ir = await fetch(`${origin}${img}`, { headers: { accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" } });
          await ir.arrayBuffer();
          imagesWarmed += 1;
        }
      }
    }
    if (v.fullWarm) {
      // The calibration's page too, and a second pass so every page is a cache hit.
      for (const url of urls) await (await fetch(url)).arrayBuffer();
      await waitIdle(pgids, v.name);
    }
  }

  // Calibration as the gate does it.
  rmSync(RAW_DIR, { recursive: true, force: true });
  if ((await runAsync("pnpm", collectArgs(v, [`${origin}/`], CALIBRATION_RUNS, ["--settings.onlyCategories=performance"]))) !== 0) {
    throw new Error("calibration failed");
  }
  const indexes = rawRuns().map((l) => l.environment?.benchmarkIndex ?? NaN);
  const indexMultiplier = calibratedSlowdown(median(indexes)!);
  console.log(`[lhx] ${v.name}: benchmarkIndex ${indexes.map(Math.round).join(", ")} -> ${indexMultiplier}x`);

  // The reference workloads' raw main-thread ms on this host, every variant.
  const measure = async (path: string): Promise<number[]> => {
    rmSync(RAW_DIR, { recursive: true, force: true });
    if ((await runAsync("pnpm", collectArgs(v, [`${REF_ORIGIN}${path}`], CALIBRATION_RUNS, ["--settings.onlyCategories=performance"]))) !== 0) {
      throw new Error(`reference runs of ${path} failed`);
    }
    const dest = join(OUT_DIR, v.name, `ref${path.replaceAll("/", "_")}`);
    mkdirSync(dest, { recursive: true });
    cpSync(RAW_DIR, dest, { recursive: true });
    return rawRuns().map((l) => Number((l.audits.diagnostics?.details?.items?.[0] as Record<string, number> | undefined)?.totalTaskTime ?? NaN));
  };
  const refMs = await measure("/reference/");
  const snapMs = await measure("/snapshot/");
  const refIndexes: number[] = [];
  const refMedian = median(refMs)!;
  const snapMedian = median(snapMs)!;
  let multiplier = indexMultiplier;
  const fromK = (name: string, w: number) => {
    const k = Number(process.env[name]);
    if (!Number.isFinite(k) || k <= 0) throw new Error(`${v.name} needs ${name}`);
    const m = Math.round((k / w) * 10) / 10;
    if (m < 1 || m > 20) throw new Error(`multiplier ${m} out of bounds`);
    return m;
  };
  if (v.refCalibrated) multiplier = fromK("RH_LHX_REF_K", refMedian);
  if (v.snapCalibrated) multiplier = fromK("RH_LHX_SNAP_K", snapMedian);
  console.log(`[lhx] ${v.name}: snapshot raw ms ${snapMs.map(Math.round).join(", ")} (median ${Math.round(snapMedian)})`);
  console.log(`[lhx] ${v.name}: reference raw ms ${refMs.map(Math.round).join(", ")} (median ${Math.round(refMedian)}), indexes ${refIndexes.map(Math.round).join(", ")}; multiplier used ${multiplier}x`);

  rmSync(RAW_DIR, { recursive: true, force: true });
  const sampler = new ChromeSampler(pgids);
  const serverBefore = pgids[0] ? groupCpuMs(pgids[0]) : 0;
  const mockBefore = pgids[1] ? groupCpuMs(pgids[1]) : 0;
  const busyBefore = systemBusyMs();
  const t0 = Date.now();
  sampler.start();
  const status = await runAsync("pnpm", collectArgs(v, urls, RUNS), { RH_LH_CPU_SLOWDOWN: String(multiplier) });
  sampler.stop();
  const wallMs = Date.now() - t0;
  if (status !== 0) throw new Error(`collect failed for ${v.name}`);
  const runs = rawRuns();
  const dest = join(OUT_DIR, v.name);
  mkdirSync(dest, { recursive: true });
  cpSync(RAW_DIR, dest, { recursive: true });
  const fmt = (m: Map<string, number>) => [...m.entries()].map(([k, n]) => `${k}×${n}`).join(" ") || "n/a";
  const result: VariantResult = {
    name: v.name,
    calibration: indexes,
    indexMultiplier,
    refMs,
    snapMs,
    multiplier,
    runs,
    serverCpuMs: pgids[0] ? groupCpuMs(pgids[0]) - serverBefore : 0,
    mockCpuMs: pgids[1] ? groupCpuMs(pgids[1]) - mockBefore : 0,
    chromeCpuMs: sampler.chromeCpuMs(),
    systemBusyMs: systemBusyMs() - busyBefore,
    wallMs,
    chromeAffinity: fmt(sampler.affinity),
    serverAffinity: fmt(sampler.serverAffinity),
    imagesWarmed,
    allUsedMultiplier: runs.every((l) => l.configSettings?.throttling?.cpuSlowdownMultiplier === multiplier),
  };
  stopServers();
  await sleep(1500);
  return result;
}

const GROUPS = ["scriptEvaluation", "styleLayout", "paintCompositeRender", "scriptParseCompile", "parseHTML", "garbageCollection", "other"];

function report(results: VariantResult[]): string {
  const lines: string[] = [];
  const med = (xs: number[]) => {
    const m = median(xs.filter((x) => Number.isFinite(x)));
    return m === null ? "n/a" : String(Math.round(m));
  };
  lines.push(`## Lighthouse experiment (${platform()}, ${cpus().length} CPUs, ${cpus()[0]?.model}), ${RUNS} runs per URL\n`);
  lines.push("| Variant | Calibration indexes | index × | ref raw ms | snap raw ms | × used | URL | TBT | LCP | FCP | Perf | idx (runs) | raw task ms | tasks>50 raw | server CPU ms | mock CPU ms | chrome CPU ms | system busy / wall | chrome affinity | server affinity | imgs warmed | all ×? |");
  lines.push("|---|---|---:|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|---|");
  for (const r of results) {
    const byUrl = new Map<string, AnyLhr[]>();
    for (const l of r.runs) byUrl.set(l.requestedUrl, [...(byUrl.get(l.requestedUrl) ?? []), l]);
    let first = true;
    for (const [url, ls] of byUrl) {
      const a = (id: string) => ls.map((l) => l.audits[id]?.numericValue ?? NaN);
      const diag = ls.map((l) => (l.audits.diagnostics?.details?.items?.[0] ?? {}) as Record<string, number>);
      const perf = median(ls.map((l) => l.categories.performance?.score ?? NaN));
      lines.push(
        `| ${first ? r.name : ""} | ${first ? r.calibration.map(Math.round).join(", ") : ""} | ${first ? r.indexMultiplier : ""} | ${first ? r.refMs.map(Math.round).join(", ") : ""} | ${first ? r.snapMs.map(Math.round).join(", ") : ""} | ${first ? r.multiplier : ""} | ${new URL(url).pathname} | ${med(a("total-blocking-time"))} | ${med(a("largest-contentful-paint"))} | ${med(a("first-contentful-paint"))} | ${perf?.toFixed(2)} | ${med(ls.map((l) => l.environment?.benchmarkIndex ?? NaN))} | ${med(diag.map((d) => d.totalTaskTime))} | ${med(diag.map((d) => d.numTasksOver50ms))} | ${first ? r.serverCpuMs : ""} | ${first ? r.mockCpuMs : ""} | ${first ? (LINUX ? r.chromeCpuMs : "n/a") : ""} | ${first ? `${(r.systemBusyMs / r.wallMs).toFixed(2)} cores` : ""} | ${first ? r.chromeAffinity : ""} | ${first ? r.serverAffinity : ""} | ${first ? r.imagesWarmed : ""} | ${first ? r.allUsedMultiplier : ""} |`,
      );
      first = false;
    }
  }
  lines.push("\n### Raw main-thread breakdown (mainthread-work-breakdown ÷ multiplier, median ms per group) and bootup-time (÷ multiplier)\n");
  lines.push(`| Variant | URL | ${GROUPS.join(" | ")} | total | bootup total | bootup top script |`);
  lines.push(`|---|---|${GROUPS.map(() => "---:").join("|")}|---:|---:|---|`);
  for (const r of results) {
    const byUrl = new Map<string, AnyLhr[]>();
    for (const l of r.runs) byUrl.set(l.requestedUrl, [...(byUrl.get(l.requestedUrl) ?? []), l]);
    for (const [url, ls] of byUrl) {
      const groupMs = (l: AnyLhr, g: string) => {
        const m = l.configSettings?.throttling?.cpuSlowdownMultiplier ?? 1;
        const item = l.audits["mainthread-work-breakdown"]?.details?.items?.find((i) => i.group === g);
        return item ? Number(item.duration) / m : 0;
      };
      const total = (l: AnyLhr) => (l.audits["mainthread-work-breakdown"]?.numericValue ?? NaN) / (l.configSettings?.throttling?.cpuSlowdownMultiplier ?? 1);
      const boot = (l: AnyLhr) => (l.audits["bootup-time"]?.numericValue ?? NaN) / (l.configSettings?.throttling?.cpuSlowdownMultiplier ?? 1);
      const top = ls[0]?.audits["bootup-time"]?.details?.items?.[0];
      const m0 = ls[0]?.configSettings?.throttling?.cpuSlowdownMultiplier ?? 1;
      const topText = top ? `${String(top.url).split("/").pop()} ${Math.round(Number(top.total) / m0)} ms` : "n/a";
      lines.push(`| ${r.name} | ${new URL(url).pathname} | ${GROUPS.map((g) => med(ls.map((l) => groupMs(l, g)))).join(" | ")} | ${med(ls.map(total))} | ${med(ls.map(boot))} | ${topText} |`);
    }
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<number> {
  const variants = (process.env.RH_LHX_VARIANTS ?? "v0").split(",").map(variantFor);
  if (variants.some((v) => !v.external)) {
    for (const url of [`${mockCmsOrigin()}/__mock/health`, `${appSiteOrigin()}/`]) {
      if (await answers(url)) throw new Error(`Something already answers at ${url}`);
    }
    if (prebuilt()) assertPrebuilt();
    else {
      const env = appServerEnv();
      if (spawnSync("pnpm", ["exec", "next", "build"], { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, ...env } }).status !== 0) return 1;
      writeBuildStamp({ ...process.env, ...env });
    }
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const refServer = await startReferenceServer(REF_PORT);
  const results: VariantResult[] = [];
  for (const v of variants) {
    results.push(await runVariant(v));
    const table = report(results);
    writeFileSync(join(OUT_DIR, "report.md"), table);
    writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results.map((r) => ({ ...r, runs: undefined })), null, 2));
  }
  refServer.close();
  const table = report(results);
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  return 0;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopServers();
    process.exit(130);
  });
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(error);
} finally {
  stopServers();
}
process.exit(code);
