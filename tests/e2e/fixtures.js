/**
 * Shared Playwright fixtures.
 *
 * Every spec imports `test` and `expect` from here instead of from
 * `@wordpress/e2e-test-utils-playwright`. The one addition is a worker-scoped,
 * automatic fixture that activates the plugin before any test in the worker
 * runs: the PHPUnit bootstrap reinstalls the tests database, which leaves every
 * plugin inactive on the tests site, so no spec may assume prior state.
 */
const base = require( '@wordpress/e2e-test-utils-playwright' );

const test = base.test.extend( {
	resourceHubActive: [
		async ( { requestUtils }, use ) => {
			await requestUtils.activatePlugin( 'resource-hub' );
			await use( true );
		},
		{ scope: 'worker', auto: true },
	],
} );

module.exports = { test, expect: base.expect };
