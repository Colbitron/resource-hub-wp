<?php
/**
 * The `resource-hub-tokens` stylesheet handle, shared with the CMS theme.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

/**
 * Registers the shared package's `tokens.css` under one handle, unless the theme already has.
 *
 * The related-resources block's stylesheet builds on the `--rh-` tokens, and so does the
 * `resource-hub` theme's. Both used to carry their own copy: the block's build inlined `tokens.css`
 * into its `style-index.css`, so a page with the block, on the theme, declared every token twice.
 * Now there is one handle, {@see self::HANDLE}, and both name it: the block's `block.json` lists it
 * before its own file in `style`, and the theme enqueues it. WordPress prints a handle once per
 * document, so a page with the block loads the tokens once, in the editor canvas and on the CMS's
 * own pages alike.
 *
 * Whoever registers the handle first provides the file, and this registers it at `init` priority
 * {@see self::PRIORITY}, after the theme's `functions.php` has had its turn at the default priority,
 * and only if nothing has: so with the `resource-hub` theme active its copy is served, and with any
 * other theme this one is, and the block is styled either way. The two copies are the package's file
 * byte for byte (the plugin's build copies it with `copy-webpack-plugin`, the theme's with its own
 * build; `SharedTokensTest` and `ThemeAssetsTest` hold both to the package), so it does not matter
 * which is served. Without a build there is no file and nothing is registered, and core skips a
 * block style handle that is not registered.
 *
 * The version is the first 20 characters of the copy's SHA-256, which the build writes to
 * `build/shared/tokens.asset.php` beside it, so a changed file gets a new URL.
 */
final class SharedTokens {
	/**
	 * The stylesheet handle the block and the theme share. Renaming it means renaming it in
	 * `blocks/related-resources/block.json` and in the theme's `functions.php`.
	 */
	public const HANDLE = 'resource-hub-tokens';

	/**
	 * The `init` priority: after the theme's registration at the default, 10.
	 */
	public const PRIORITY = 20;

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
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_style' ), self::PRIORITY );
	}

	/**
	 * Registers the plugin's copy of `tokens.css`, when the build exists and no one has registered the handle.
	 */
	public function register_style(): void {
		if ( wp_style_is( self::HANDLE, 'registered' ) ) {
			return;
		}

		if ( ! is_readable( dirname( __DIR__, 2 ) . '/build/shared/tokens.asset.php' ) ) {
			return;
		}

		$asset = require dirname( __DIR__, 2 ) . '/build/shared/tokens.asset.php';

		wp_register_style(
			self::HANDLE,
			plugins_url( 'build/shared/tokens.css', $this->plugin_file ),
			array(),
			$asset['version'] ?? false
		);
	}
}
