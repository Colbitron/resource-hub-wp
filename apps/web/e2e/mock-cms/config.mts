/**
 * The two ports the end-to-end harness uses and the mock CMS's addresses,
 * read from the environment with fixed defaults. Shared by
 * `playwright.config.ts`, the mock's entry point and the specs, so one place
 * decides what `WP_API_URL` the front end under test is given.
 *
 * The mock binds to and names itself by `127.0.0.1`, not `localhost`: the
 * front end's server and the specs then reach it over IPv4 whatever the
 * machine resolves `localhost` to, and the origin the specs look for in
 * rendered HTML is one exact string.
 */

/** Port `next start` serves the app under test on; `RH_WEB_PORT` overrides it. */
export const DEFAULT_WEB_PORT = 3310;

/** Port the mock CMS listens on; `RH_MOCK_CMS_PORT` overrides it. */
export const DEFAULT_MOCK_CMS_PORT = 4010;

/**
 * The `REVALIDATE_SECRET` the app under test is started with, and the bearer
 * `e2e/revalidate.spec.ts` sends. A fixed, obviously-not-secret value: the
 * harness never touches a real CMS or a real secret.
 */
export const E2E_REVALIDATE_SECRET = "e2e-revalidate-secret-not-for-real-use";

/** The address the mock binds to and puts in every URL it emits. */
export const MOCK_CMS_HOST = "127.0.0.1";

type Env = Readonly<Record<string, string | undefined>>;

function port(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw new Error(`${name} must be a port number between 1 and 65535, not "${raw}".`);
  }
  return Number(raw);
}

export function webPort(env: Env = process.env): number {
  return port(env, "RH_WEB_PORT", DEFAULT_WEB_PORT);
}

export function mockCmsPort(env: Env = process.env): number {
  return port(env, "RH_MOCK_CMS_PORT", DEFAULT_MOCK_CMS_PORT);
}

/** The mock's origin, `http://127.0.0.1:4010` by default. */
export function mockCmsOrigin(env: Env = process.env): string {
  return `http://${MOCK_CMS_HOST}:${mockCmsPort(env)}`;
}

/** The `WP_API_URL` the front end under test is started with. */
export function mockCmsApiUrl(env: Env = process.env): string {
  return `${mockCmsOrigin(env)}/wp-json`;
}
