/**
 * Extends the `@wordpress/scripts` webpack config with one non-block entry.
 *
 * `wp-scripts build --webpack-src-dir=blocks` discovers block entries from
 * `block.json` files under `blocks/`. The editor sidebar panel and the
 * revalidation feedback are plugins, not blocks, so they are added here as
 * `editor/resource-details` and `editor/revalidation-feedback`, each landing
 * under `build/editor/` with its `.asset.php` beside it.
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
		'editor/revalidation-feedback': resolve(
			__dirname,
			'editor/revalidation-feedback/index.js'
		),
	} ),
};

module.exports = otherConfigs.length ? [ config, ...otherConfigs ] : config;
