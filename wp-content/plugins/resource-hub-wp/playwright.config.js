/**
 * Playwright configuration.
 *
 * Extends the `@wordpress/scripts` base config, which logs in to the wp-env
 * tests site (port 8889) once and shares the session with every spec.
 * wp-env is configured and installed at the workspace root, so the web
 * server command runs the root `env:start` script from here.
 */
const { defineConfig } = require( '@playwright/test' );
const baseConfig = require( '@wordpress/scripts/config/playwright.config' );

module.exports = defineConfig( {
	...baseConfig,
	testDir: './tests/e2e',
	webServer: {
		...baseConfig.webServer,
		command: 'pnpm --workspace-root env:start',
	},
} );
