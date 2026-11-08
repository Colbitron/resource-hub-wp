<?php
/**
 * The Resource Hub theme's stylesheets: the shared tokens, Figtree's fallback faces and the lockup.
 *
 * `theme.json` does the rest of the styling: it registers Figtree from `build/fonts/` and maps its
 * colour, type and spacing presets to the `--rh-` tokens, which this file loads. Every file named
 * here is a copy of the contract package's (`@colbitron/resource-hub-ui`), made by `pnpm build`
 * (`scripts/build.mjs`) into `build/`, because the host never sees the workspace. Without a build
 * nothing is registered and the pages render in the browser's defaults, as before this theme had
 * assets.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the three stylesheets from `build/`, on `init`.
 *
 * - `resource-hub-tokens`: `tokens.css`, the `--rh-` custom properties, with `color-scheme: light
 *   dark` and every colour a `light-dark()` pair, so the CMS follows the reader's system preference
 *   by default, as the front end does (`packages/ui/DESIGN.md`, "Theme and colour scheme"). The
 *   handle is shared with the plugin's related-resources block, which lists it in its `block.json`;
 *   the plugin registers its own copy at a later priority only when this has not, so a page with the
 *   block loads the tokens once (`ResourceHub\Blocks\SharedTokens` in the plugin).
 * - `resource-hub-figtree-fallback`: the size-adjusted faces `--rh-font-sans` lists after Figtree,
 *   so a page drawn before the font file lands takes nearly the space it will in Figtree.
 * - `resource-hub-brand`: the lockup in `parts/header.html`, on the tokens.
 *
 * Each version is the first 20 characters of the copy's SHA-256 from `build/assets.php`, so a
 * changed file gets a new URL.
 */
function resource_hub_theme_register_styles(): void {
	if ( ! is_readable( __DIR__ . '/build/assets.php' ) ) {
		return;
	}

	$hashes  = require __DIR__ . '/build/assets.php';
	$version = static fn ( string $file ): string => substr( (string) ( $hashes[ $file ] ?? '' ), 0, 20 );

	wp_register_style( 'resource-hub-tokens', get_theme_file_uri( 'build/tokens.css' ), array(), $version( 'tokens.css' ) );
	wp_register_style( 'resource-hub-figtree-fallback', get_theme_file_uri( 'build/fonts/figtree-fallback.css' ), array(), $version( 'fonts/figtree-fallback.css' ) );
	wp_register_style( 'resource-hub-brand', get_theme_file_uri( 'build/brand.css' ), array( 'resource-hub-tokens' ), $version( 'brand.css' ) );
}
add_action( 'init', 'resource_hub_theme_register_styles' );

/**
 * Enqueues the three stylesheets on the CMS's own pages and in the editor canvas, on `enqueue_block_assets`.
 *
 * That one hook reaches both: core fires it from `wp_enqueue_scripts` on the front of the site, and
 * again while it collects the iframed editor canvas's assets, so an editor's preview and the canvas
 * they edit in load the same files. Core also fires it on the editor's own admin page, around the
 * canvas, where no content is drawn, so the theme loads nothing there: that page is the one where
 * `wp_should_load_block_editor_scripts_and_styles()` is true in the admin, and core filters it to
 * false while it collects the canvas's assets. (Core does enqueue every registered block's style on
 * that page, so the related-resources block brings the tokens there through the shared handle, as
 * its stylesheet did before the handle existed.) `add_editor_style()` is not used, because it inlines
 * a copy of the file into the editor's settings, which would load the tokens a second time beside the
 * block's handle.
 */
function resource_hub_theme_enqueue_styles(): void {
	if ( is_admin() && wp_should_load_block_editor_scripts_and_styles() ) {
		return;
	}

	wp_enqueue_style( 'resource-hub-tokens' );
	wp_enqueue_style( 'resource-hub-figtree-fallback' );
	wp_enqueue_style( 'resource-hub-brand' );
}
add_action( 'enqueue_block_assets', 'resource_hub_theme_enqueue_styles' );
