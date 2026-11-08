/**
 * Shared Playwright fixtures.
 *
 * Every spec imports `test` and `expect` from here instead of from
 * `@wordpress/e2e-test-utils-playwright`. The one addition is a worker-scoped,
 * automatic fixture that activates the plugin and the `resource-hub` theme
 * before any test in the worker runs: the PHPUnit bootstrap reinstalls the
 * tests database, which leaves every plugin inactive and the site on a theme
 * that does not exist (the core test library's `default`), so no spec may
 * assume prior state. wp-env's `afterStart` script activates the theme too,
 * but PHPUnit undoes that on the tests site.
 */
const base = require( '@wordpress/e2e-test-utils-playwright' );

const test = base.test.extend( {
	resourceHubActive: [
		async ( { requestUtils }, use ) => {
			await requestUtils.activatePlugin( 'resource-hub' );
			await requestUtils.activateTheme( 'resource-hub' );
			await use( true );
		},
		{ scope: 'worker', auto: true },
	],
} );

module.exports = { test, expect: base.expect };
