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
 * for the type marks the plugin's blocks write (the related-resources rows,
 * the resource-card row and the resource-meta line). The host gets only
 * `build/`, `src/` and `vendor/` from the deploy, never the workspace, so the
 * table travels in `build/` as the blocks' stylesheets do; a PHPUnit test
 * fails when the copy differs from the package's (`packages/ui/README.md`,
 * "Type accents").
 *
 * It also copies three of the shared package's stylesheets to `build/shared/`,
 * byte for byte, each with an `.asset.php` holding its version: `tokens.css`,
 * for the `resource-hub-tokens` handle the blocks and the theme share
 * (`src/Blocks/SharedTokens.php`), and `card.css` with `card-labels.css`
 * beside it, for the `resource-hub-card` handle the related-resources and
 * resource-card blocks share (`src/Blocks/SharedCard.php`). `card.css`
 * imports `./card-labels.css`, so the two ship side by side, and the card's
 * version is the hash of both, so a change to either gives `card.css` a new
 * URL. Copies and not entries, because the CSS minifier rewrites colours on
 * the way (an `rgb()` with a slash came out as a rounded `hsla()`), and the
 * CMS should draw the package's own values. The copy plugin is the one
 * wp-scripts already configures, so no second version of it is installed.
 */
const { createHash } = require( 'crypto' );
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

// Found among wp-scripts' own plugins rather than declared here, so the build
// keeps the one copy-webpack-plugin wp-scripts is tested with. If a wp-scripts
// upgrade drops or renames it, fail loudly instead of silently shipping a build
// without the tokens copy that `src/Blocks/SharedTokens.php` registers.
const copyPluginInstance = scriptConfig.plugins.find(
	( plugin ) => plugin.constructor.name === 'CopyPlugin'
);
if ( ! copyPluginInstance ) {
	throw new Error(
		'webpack.config.js: @wordpress/scripts no longer configures CopyPlugin, so build/shared/tokens.css cannot be copied. Declare copy-webpack-plugin in package.json and import it here instead.'
	);
}
const CopyPlugin = copyPluginInstance.constructor;

const tokens = require.resolve( '@colbitron/resource-hub-ui/tokens.css' );
const card = require.resolve( '@colbitron/resource-hub-ui/card.css' );
const cardLabels =
	require.resolve( '@colbitron/resource-hub-ui/card-labels.css' );

// The `.asset.php` convention the plugin's other builds follow: a version of 20 hex characters, from every file the stylesheet loads.
const asset = ( ...contents ) => {
	const hash = createHash( 'sha256' );
	contents.forEach( ( content ) => hash.update( content ) );
	const version = hash.digest( 'hex' ).slice( 0, 20 );
	return `<?php return array( 'version' => '${ version }' );\n`;
};

const config = {
	...scriptConfig,
	plugins: [
		...scriptConfig.plugins,
		new TypeAccentsPlugin(),
		new CopyPlugin( {
			patterns: [
				{ from: tokens, to: 'shared/tokens.css' },
				{
					from: tokens,
					to: 'shared/tokens.asset.php',
					transform: ( content ) => asset( content ),
				},
				{ from: card, to: 'shared/card.css' },
				{ from: cardLabels, to: 'shared/card-labels.css' },
				{
					from: card,
					to: 'shared/card.asset.php',
					transform: ( content ) =>
						asset( content, readFileSync( cardLabels ) ),
				},
			],
		} ),
	],
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
