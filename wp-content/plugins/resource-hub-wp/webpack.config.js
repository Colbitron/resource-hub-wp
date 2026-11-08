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
 *
 * The build also emits the shared package's type-accent table, unchanged, as
 * `build/type-accents.json`, which `ResourceHub\Blocks\TypeAccents` reads
 * for the related-resources block's rows. The host gets only `build/`, `src/`
 * and `vendor/` from the deploy, never the workspace, so the table travels in
 * `build/` as the block's stylesheet does; a PHPUnit test fails when the copy
 * differs from the package's (`packages/ui/README.md`, "Type accents").
 */
const { readFileSync } = require( 'fs' );
const { resolve } = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );

// With WP_EXPERIMENTAL_MODULES the default export is [ scriptConfig, moduleConfig ].
const [ scriptConfig, ...otherConfigs ] = Array.isArray( defaultConfig )
	? defaultConfig
	: [ defaultConfig ];

const TYPE_ACCENTS =
	require.resolve( '@colbitron/resource-hub-ui/type-accents.json' );

/**
 * Emits the package's `type-accents.json` as `build/type-accents.json`, byte
 * for byte, and watches it, so `pnpm start` picks up a changed row too.
 */
class TypeAccentsPlugin {
	apply( compiler ) {
		const { Compilation, sources } = compiler.webpack;
		const name = 'TypeAccentsPlugin';

		compiler.hooks.thisCompilation.tap( name, ( compilation ) => {
			compilation.fileDependencies.add( TYPE_ACCENTS );
			compilation.hooks.processAssets.tap(
				{ name, stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
				() => {
					compilation.emitAsset(
						'type-accents.json',
						new sources.RawSource( readFileSync( TYPE_ACCENTS ) )
					);
				}
			);
		} );
	}
}

const config = {
	...scriptConfig,
	plugins: [ ...scriptConfig.plugins, new TypeAccentsPlugin() ],
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
