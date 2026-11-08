<?php
/**
 * The Resource Hub theme's stylesheets, and the table block's scroll region.
 *
 * `theme.json` does the editor-facing styling: it registers Figtree from `build/fonts/` and maps its
 * colour, type and spacing presets to the `--rh-` tokens, which this file loads, and mirrors the
 * document's base styles for the editor canvas. Every stylesheet named here is a copy of the
 * contract package's (`@colbitron/resource-hub-ui`), made by `pnpm build` (`scripts/build.mjs`)
 * into `build/`, because the host never sees the workspace. Without a build nothing is registered
 * and the pages render in the browser's defaults, as before this theme had assets.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/inc/table-region.php';

/**
 * Each stylesheet's handle, its copy under `build/`, and the handles it loads after.
 *
 * - `resource-hub-tokens`: `tokens.css`, the `--rh-` custom properties, with `color-scheme: light
 *   dark` and every colour a `light-dark()` pair, so the CMS follows the reader's system preference
 *   by default, as the front end does (`packages/ui/DESIGN.md`, "Theme and colour scheme"). The
 *   handle is shared with the plugin's related-resources block, which lists it in its `block.json`;
 *   the plugin registers its own copy at a later priority only when this has not, so a page with the
 *   block loads the tokens once (`ResourceHub\Blocks\SharedTokens` in the plugin).
 * - `resource-hub-figtree-fallback`: the size-adjusted faces `--rh-font-sans` lists after Figtree,
 *   so a page drawn before the font file lands takes nearly the space it will in Figtree.
 * - `resource-hub-brand`: the lockup in `parts/header.html`.
 * - `resource-hub-base` and `resource-hub-shell`: the document and the landmarks' layout every
 *   template sits in, as the front end's `Shell` loads them.
 * - `resource-hub-prose` and `resource-hub-page`: the article `page.html` and `index.html` render.
 * - `resource-hub-welcome`: the welcome `home.html` renders, beside `page.css`.
 * - `resource-hub-not-found`: the 404's column.
 *
 * @return array<string, array{0: string, 1: string[]}>
 */
function resource_hub_theme_styles(): array {
	return array(
		'resource-hub-tokens'           => array( 'tokens.css', array() ),
		'resource-hub-figtree-fallback' => array( 'fonts/figtree-fallback.css', array() ),
		'resource-hub-brand'            => array( 'brand.css', array( 'resource-hub-tokens' ) ),
		'resource-hub-base'             => array( 'base.css', array( 'resource-hub-tokens', 'resource-hub-figtree-fallback' ) ),
		'resource-hub-shell'            => array( 'shell.css', array( 'resource-hub-base' ) ),
		'resource-hub-prose'            => array( 'prose.css', array( 'resource-hub-base' ) ),
		'resource-hub-page'             => array( 'page.css', array( 'resource-hub-base' ) ),
		'resource-hub-welcome'          => array( 'welcome.css', array( 'resource-hub-page' ) ),
		'resource-hub-not-found'        => array( 'not-found.css', array( 'resource-hub-base' ) ),
	);
}

/**
 * Registers the stylesheets from `build/`, on `init`.
 *
 * Each version is the first 20 characters of the copy's SHA-256 from `build/assets.php`, so a
 * changed file gets a new URL.
 */
function resource_hub_theme_register_styles(): void {
	if ( ! is_readable( __DIR__ . '/build/assets.php' ) ) {
		return;
	}

	$hashes = require __DIR__ . '/build/assets.php';

	foreach ( resource_hub_theme_styles() as $handle => list( $file, $deps ) ) {
		wp_register_style( $handle, get_theme_file_uri( 'build/' . $file ), $deps, substr( (string) ( $hashes[ $file ] ?? '' ), 0, 20 ) );
	}
}
// At init's default priority, so the theme registers `resource-hub-tokens` before the plugin's
// fallback registration at priority 20 (`SharedTokens::PRIORITY`) and its copy is the one served.
add_action( 'init', 'resource_hub_theme_register_styles' );

/**
 * Enqueues the tokens, the fallback faces and the lockup on the CMS's own pages and in the editor
 * canvas, on `enqueue_block_assets`.
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
 *
 * The document and the components are not loaded in the canvas: see
 * {@see resource_hub_theme_enqueue_page_styles()}.
 *
 * Caveat: if core ever draws the canvas without an iframe, the canvas is part of that admin page, so
 * it would get the tokens through the block's handle but not the fallback faces or the lockup's CSS.
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

/**
 * Enqueues the document, the shell and the template's components on the CMS's own pages, after
 * core's global styles, on `wp_enqueue_scripts` at priority 20.
 *
 * **After core's global styles.** `base.css` styles bare elements (`body`, `a`, the headings), as
 * `theme.json`'s base styles do, at the same specificity, so whichever prints last wins a tie.
 * Core enqueues its global styles (`global-styles-inline-css`, which also carries any Styles change
 * an editor saves in the Site Editor) on `wp_enqueue_scripts` at priority 10, so enqueuing these at
 * 20 prints them after: on a CMS page the package's rules win, and the page computes what the front
 * end computes from the same file, which loads no global styles at all. The values agree today
 * (`theme.json` mirrors `base.css` from the same tokens); the order decides only when they part, as
 * after a Site Editor Styles change, which never reaches the front end either. Order, not a
 * dependency on the `global-styles` handle, so a renamed handle cannot drop `base.css` from the page.
 *
 * **Not in the editor canvas.** The canvas is an editing surface, not a page: it has no shell, and
 * core lays its content out itself, a constrained layout of `layout.contentSize` with the editor's
 * own spacing and focus styles. There `theme.json`'s base styles, which core injects into the
 * canvas, give the body, links and `h1`–`h3` the same type, sizes and colours `base.css` does, so an
 * editor's content reads in the site's type and colours, in the editor's column rather than the
 * site's. `base.css`'s bare-element margins and `*` box sizing would reach the editor's own controls
 * drawn inside the iframe, and the shell and the article are the page around the content, which the
 * canvas shows only when an editor turns on the template preview.
 *
 * **Per template.** Every template sits in the shell. The 404 (`is_404()`) loads `not-found.css`;
 * `home.html` (`is_home()`: `/` while the front page shows posts, the CMS's state today, and the
 * posts page under a static front page) loads `welcome.css` after `page.css`; every other template,
 * `page.html` and `index.html`, renders the article and loads `prose.css` and `page.css`.
 *
 * **Core block styles that fight the body's.** Core enqueues each block's stylesheet as the block
 * renders, before `wp_head`, and three draw over what `prose.css` gives the same elements, which the
 * front end, loading no core CSS, never shows: `wp-block-table` (a border on every side of every
 * cell, a 3 px rule under the head, a fixed table layout, the scroll on the figure rather than the
 * region), `wp-block-code` (code set as a block in the body's font, not the monospace inset) and
 * `wp-block-separator` (a 2 px rule in the text colour, not the hairline). They are dequeued here,
 * on the CMS's own pages only; the editor canvas keeps them. The other core block styles a body can
 * bring set box sizing, wrapping or classes an editor opts into, and stay.
 */
function resource_hub_theme_enqueue_page_styles(): void {
	wp_enqueue_style( 'resource-hub-base' );
	wp_enqueue_style( 'resource-hub-shell' );

	if ( is_404() ) {
		wp_enqueue_style( 'resource-hub-not-found' );
	} elseif ( is_home() ) {
		wp_enqueue_style( 'resource-hub-welcome' );
	} else {
		wp_enqueue_style( 'resource-hub-prose' );
		wp_enqueue_style( 'resource-hub-page' );
	}

	foreach ( array( 'wp-block-table', 'wp-block-code', 'wp-block-separator' ) as $handle ) {
		wp_dequeue_style( $handle );
	}
}
add_action( 'wp_enqueue_scripts', 'resource_hub_theme_enqueue_page_styles', 20 );

// Each core/table block on a page core renders with a template, in the front end's scroll region.
add_action( 'template_redirect', 'resource_hub_theme_add_table_regions' );
