/**
 * Extends the `@wordpress/scripts` webpack config with one non-block entry.
 *
 * `wp-scripts build --webpack-src-dir=blocks` discovers block entries from
 * `block.json` files under `blocks/`. The editor sidebar panel is a plugin,
 * not a block, so it is added here as `editor/resource-details`, which lands
 * at `build/editor/resource-details.js` with its `.asset.php` beside it.
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
	} ),
};

module.exports = otherConfigs.length ? [ config, ...otherConfigs ] : config;
