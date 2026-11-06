import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertPrebuilt, BUILD_VARIABLES, buildStampProblem, writeBuildStamp } from "../e2e/build-stamp.mts";
import { appServerEnv } from "../e2e/mock-cms/config.mts";

type Env = Record<string, string | undefined>;

// The harness's build stamp (e2e/build-stamp.mts) against a temporary
// `.next` with a fixed commit, so no test touches the real build or git.

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const RUN_ENV: Env = { RH_WEB_PORT: "3460", RH_MOCK_CMS_PORT: "4160" };

let nextDir: string;
let commit: string | null;
const options = () => ({ nextDir, commit: () => commit });

/** The environment a harness build for RUN_ENV sees: the shell's plus `appServerEnv`. */
const buildEnv = (env: Env = RUN_ENV): Env => ({ ...env, ...appServerEnv(env) });

beforeEach(() => {
  nextDir = mkdtempSync(join(tmpdir(), "rh-build-stamp-"));
  writeFileSync(join(nextDir, "BUILD_ID"), "build-one\n");
  commit = COMMIT;
});

afterEach(() => {
  rmSync(nextDir, { recursive: true, force: true });
});

describe("buildStampProblem", () => {
  it("accepts the harness's build for the same ports at the same commit", () => {
    writeBuildStamp(buildEnv(), options());
    expect(buildStampProblem(RUN_ENV, options())).toBeNull();
    expect(() => assertPrebuilt(RUN_ENV, options())).not.toThrow();
  });

  it("stamps every variable that changes the build, WP_MEDIA_ORIGIN included", () => {
    expect(BUILD_VARIABLES).toEqual(["RH_FIXTURES", "WP_API_URL", "WP_MEDIA_ORIGIN", "SITE_URL"]);
  });

  it("reports a missing build", () => {
    rmSync(join(nextDir, "BUILD_ID"));
    expect(buildStampProblem(RUN_ENV, options())).toBe("there is no build in .next");
  });

  it("reports a build the harness did not stamp, such as a production build", () => {
    expect(buildStampProblem(RUN_ENV, options())).toMatch(/not made by the end-to-end harness/);
  });

  it("reports a build made after the stamp", () => {
    writeBuildStamp(buildEnv(), options());
    writeFileSync(join(nextDir, "BUILD_ID"), "build-two\n");
    expect(buildStampProblem(RUN_ENV, options())).toMatch(/\(build-two\) is newer than the harness's stamp \(build-one\)/);
  });

  it("reports a build made at another commit", () => {
    writeBuildStamp(buildEnv(), options());
    commit = "fedcba9876543210fedcba9876543210fedcba98";
    expect(buildStampProblem(RUN_ENV, options())).toMatch(new RegExp(`made at commit ${COMMIT}, but fedcba98`));
  });

  it("reports a stamp from before commits were recorded", () => {
    writeFileSync(
      join(nextDir, "rh-e2e-build.json"),
      JSON.stringify({ buildId: "build-one", env: buildEnv() }),
    );
    expect(buildStampProblem(RUN_ENV, options())).toMatch(/made at commit \(unknown\)/);
  });

  it("reports a build for other ports, naming each variable that differs", () => {
    writeBuildStamp(buildEnv({}), options());
    const problem = buildStampProblem(RUN_ENV, options());
    expect(problem).toMatch(/WP_API_URL was "http:\/\/127\.0\.0\.1:4010\/wp-json", this run needs "http:\/\/127\.0\.0\.1:4160\/wp-json"/);
    expect(problem).toMatch(/SITE_URL was "http:\/\/localhost:3310", this run needs "http:\/\/localhost:3460"/);
    expect(problem).not.toMatch(/RH_FIXTURES/);
  });

  it("reports a build with a media origin of its own", () => {
    writeBuildStamp({ ...buildEnv(), WP_MEDIA_ORIGIN: "https://media.example" }, options());
    expect(buildStampProblem(RUN_ENV, options())).toBe(
      'the build in .next was made with other settings: WP_MEDIA_ORIGIN was "https://media.example", this run needs ""',
    );
  });

  it("reports a build without the fixture routes", () => {
    writeBuildStamp({ ...buildEnv(), RH_FIXTURES: undefined }, options());
    expect(buildStampProblem(RUN_ENV, options())).toMatch(/RH_FIXTURES was undefined, this run needs "1"/);
  });

  it("throws the problem with what to do", () => {
    expect(() => assertPrebuilt(RUN_ENV, options())).toThrow(/^RH_E2E_PREBUILT=1, but .*Unset RH_E2E_PREBUILT to build/);
  });
});
