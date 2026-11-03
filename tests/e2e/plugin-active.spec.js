/**
 * Smoke test: the environment is up, the admin session works, and the plugin
 * can be activated. Every later e2e test builds on these three facts.
 *
 * Activation is explicit because the PHPUnit bootstrap reinstalls the tests
 * database, which leaves every plugin inactive on the tests site.
 */
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'Resource Hub plugin', () => {
	test.beforeAll( async ( { requestUtils } ) => {
		await requestUtils.activatePlugin( 'resource-hub' );
	} );

	test( 'shows as active on the plugins screen', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'plugins.php' );

		const row = page.getByRole( 'row', { name: /Resource Hub/ } );
		await expect(
			row.getByRole( 'link', { name: 'Deactivate Resource Hub' } )
		).toBeVisible();
	} );
} );
