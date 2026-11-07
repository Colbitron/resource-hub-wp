/**
 * Extends the `@wordpress/scripts` webpack config with the non-block entries.
 *
 * `wp-scripts build --webpack-src-dir=blocks` discovers block entries from
 * `block.json` files under `blocks/`. The editor sidebar panel, the
 * required-fields plugin and the revalidation feedback are plugins, not
 * blocks, and the status page's picker is an admin script, so they are added
 * here: `editor/resource-details`, `editor/required-fields`,
 * `editor/revalidation-feedback` and `admin/status-page`, each landing under
 * `build/` with its `.asset.php` beside it.
 */
const { resolve } = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );

// With WP_EXPERIMENTAL_MODULES the default export is [ scriptConfig, moduleConfig ].
const [ scriptConfig, ...otherConfigs ] = Array.isArray( defaultConfig )
	? defaultConfig
	: [ defaultConfig ];

const config = {
	...scriptConfig,
	entry: () => ( {
		...scriptConfig.entry(),
		'editor/resource-details': resolve(
			__dirname,
			'editor/resource-details/index.js'
		),
		'editor/required-fields': resolve(
			__dirname,
			'editor/required-fields/index.js'
		),
		'editor/revalidation-feedback': resolve(
			__dirname,
			'editor/revalidation-feedback/index.js'
		),
		'admin/status-page': resolve( __dirname, 'admin/status-page/index.js' ),
	} ),
};

module.exports = otherConfigs.length ? [ config, ...otherConfigs ] : config;
