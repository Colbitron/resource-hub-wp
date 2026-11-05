import { MOCK_CMS_HOST, mockCmsPort } from "./config.mts";
import { startMockCms } from "./server.mts";

/**
 * The command Playwright's web server runs: `node e2e/mock-cms/main.mts`.
 * Node 24 runs TypeScript directly (type stripping), so there is no build
 * step and no loader. `RH_MOCK_CMS_PORT` picks the port; 4010 by default.
 */
const server = await startMockCms({ port: mockCmsPort(), host: MOCK_CMS_HOST });
console.log(`[mock-cms] listening at ${server.origin}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
