/**
 * Smoke test: the environment is up, the admin session works, and the plugin
 * is active. Every later e2e test builds on these three facts.
 *
 * Activation itself happens in the shared fixture (see fixtures.js).
 */
const { test, expect } = require( './fixtures' );

test.describe( 'Resource Hub plugin', () => {
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
