<?php
/**
 * The `resource-hub-card` stylesheet handle, shared by the blocks that render card rows.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

/**
 * Registers the shared package's `card.css` under one handle, unless something already has.
 *
 * The related-resources block's rows and the resource-card block's row are the same markup, styled by
 * the same file. Each block used to inline its own copy into its `style-index.css`, so a page with both
 * (a resource page's related list under a Query Loop of cards) declared every row rule twice. Now both
 * blocks' `block.json` list {@see self::HANDLE} after the `resource-hub-tokens` handle in `style`, and
 * WordPress prints a handle once per document, so the row's rules load once, in the editor canvas and on
 * the CMS's own pages alike.
 *
 * The file is `build/shared/card.css`, the package's file byte for byte, as `SharedTokens`' is
 * (`webpack.config.js` copies it; `SharedCardTest` holds the copy to the package). The package's
 * `card.css` begins with `@import "./card-labels.css"`, so the build copies `card-labels.css` beside it,
 * and the browser fetches it from there; the version is the first 20 characters of the SHA-256 of both
 * files, which the build writes to `build/shared/card.asset.php`, so a change to either gives `card.css` a
 * new URL. The imported file's URL carries no version: a changed `card-labels.css` reaches a browser that
 * cached the old one when that cache expires, which only editors and logged-in previews see. The handle
 * gets no `path` data, so core never inlines it into a `<style>`, where the relative `@import` would
 * resolve against the page rather than the file.
 *
 * As with the tokens, whoever registers the handle first provides the file, and this registers it at
 * `init` priority {@see SharedTokens::PRIORITY}, after a theme's `functions.php`, only if nothing has: a
 * theme whose templates load the row itself can serve its own copy, and the blocks keep their rows'
 * styles in any theme. Without a build there is no file and nothing is registered, and core skips a block
 * style handle that is not registered. The `resource-meta` block does not use the handle: its line takes
 * the row's labels alone, `card-labels.css`, inlined into its own stylesheet, as the front end's
 * `ResourceArticle` imports that file alone.
 */
final class SharedCard {
	/**
	 * The stylesheet handle the blocks share. Renaming it means renaming it in
	 * `blocks/related-resources/block.json` and `blocks/resource-card/block.json`.
	 */
	public const HANDLE = 'resource-hub-card';

	/**
	 * Absolute path to the plugin's main file, for `plugins_url()`.
	 *
	 * @var string
	 */
	private string $plugin_file;

	/**
	 * Constructor.
	 *
	 * @param string $plugin_file Absolute path to the plugin's main file.
	 */
	public function __construct( string $plugin_file ) {
		$this->plugin_file = $plugin_file;
	}

	/**
	 * Hooks the registration onto `init`, at the tokens' priority.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_style' ), SharedTokens::PRIORITY );
	}

	/**
	 * Registers the plugin's copy of `card.css`, when the build exists and no one has registered the handle.
	 */
	public function register_style(): void {
		if ( wp_style_is( self::HANDLE, 'registered' ) ) {
			return;
		}

		if ( ! is_readable( dirname( __DIR__, 2 ) . '/build/shared/card.asset.php' ) ) {
			return;
		}

		$asset = require dirname( __DIR__, 2 ) . '/build/shared/card.asset.php';

		wp_register_style(
			self::HANDLE,
			plugins_url( 'build/shared/card.css', $this->plugin_file ),
			array(),
			$asset['version'] ?? false
		);
	}
}
