/**
 * Playwright configuration.
 *
 * Extends the `@wordpress/scripts` base config, which logs in to the wp-env
 * tests site (port 8889) once and shares the session with every spec.
 */
const { defineConfig } = require( '@playwright/test' );
const baseConfig = require( '@wordpress/scripts/config/playwright.config' );

module.exports = defineConfig( {
	...baseConfig,
	testDir: './tests/e2e',
	webServer: {
		...baseConfig.webServer,
		command: 'pnpm env:start',
	},
} );
