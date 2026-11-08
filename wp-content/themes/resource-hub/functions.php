<?php
/**
 * The Resource Hub theme's stylesheets, its adjustments to core's table and image blocks, and the
 * footer's theme control's script.
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
require_once __DIR__ . '/inc/image-lightbox.php';
require_once __DIR__ . '/inc/theme-control.php';

/**
 * Registers the stylesheets from `build/`, on `init`.
 *
 * The theme's one list of its stylesheets is `ASSETS` in `scripts/build.mjs`, which writes it into
 * `build/assets.php`: each copy's SHA-256, and each stylesheet's handle, its file and the handles it
 * loads after (the tokens; the fallback faces; the lockup; the document and the shell every template
 * sits in; the page's article, the resource's article and its related section, the welcome and the
 * 404's column). Each is registered from there, its
 * version the first 20 characters of its copy's SHA-256, so a changed file gets a new URL.
 * `resource-hub-tokens` is shared with the plugin's related-resources block, which lists it in its
 * `block.json`; the plugin registers its own copy at a later priority only when this has not, so a
 * page with the block loads the tokens once (`ResourceHub\Blocks\SharedTokens` in the plugin).
 * `tokens.css` sets `color-scheme: light dark` and writes every colour as a `light-dark()` pair, so
 * the CMS follows the reader's system preference by default, as the front end does
 * (`packages/ui/DESIGN.md`, "Theme and colour scheme").
 */
function resource_hub_theme_register_styles(): void {
	if ( ! is_readable( __DIR__ . '/build/assets.php' ) ) {
		return;
	}

	$assets = require __DIR__ . '/build/assets.php';
	// A build from before the manifest had `styles` returned the hashes alone; without the table
	// there is nothing to register, quietly, until the next `pnpm build`.
	if ( ! is_array( $assets['styles'] ?? null ) ) {
		return;
	}

	foreach ( $assets['styles'] as $handle => list( $file, $deps ) ) {
		wp_register_style( $handle, get_theme_file_uri( 'build/' . $file ), $deps, substr( (string) ( $assets['copies'][ $file ] ?? '' ), 0, 20 ) );
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
 * The shell's height under the admin bar, which only the CMS has.
 *
 * `shell.css` makes `.rh-shell` at least the viewport's height, `100dvh`, so the footer sits at the
 * bottom of a short page. For a logged-in user core adds the admin bar and pushes `<html>` down by
 * its height (`margin-top`, 32 px, or 46 px at 782 px and under), so a short page was that much
 * taller than the viewport and scrolled. Core's `admin-bar.css` gives that height as
 * `--wp-admin--admin-bar--height` on `<html>`, so under `body.admin-bar` the shell's minimum is the
 * viewport less it: `100vh` first, for an engine without `dvh`, as `shell.css` writes it. The front
 * end has no admin bar, so this is the theme's, added inline after `shell.css`, not the package's.
 */
const RESOURCE_HUB_THEME_ADMIN_BAR_SHELL = 'body.admin-bar .rh-shell { min-height: calc(100vh - var(--wp-admin--admin-bar--height, 0px)); min-height: calc(100dvh - var(--wp-admin--admin-bar--height, 0px)); }';

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
 * **The theme control.** Every template but the 404 renders the footer part's System / Light / Dark
 * control (`inc/theme-control.php`), so every page with it loads `theme-toggle.css`
 * (`resource-hub-theme-toggle`) after the shell; the 404, the one page anonymous visitors get, loads
 * no script and no `theme-toggle.css`, and the rule the `<noscript>` carries elsewhere removes the
 * control's slot from its footer, added inline after `shell.css` like the admin bar's.
 *
 * **Per template.** Every template sits in the shell. The 404 (`is_404()`) loads `not-found.css`;
 * `home.html` (`is_home()`: `/` while the front page shows posts, the CMS's state today, and the
 * posts page under a static front page) loads `welcome.css` after `page.css`; a single resource
 * (`is_singular( 'resource' )`, `single-resource.html`) loads `prose.css`, `resource.css` and
 * `related.css`, the front end's resource page's three, and not `page.css`: `related.css` on every
 * resource page, whether or not the related block renders anything, because the front end's resource
 * route always carries it and the same file draws the heading of a related-resources block in the
 * body; the meta line's labels (`card-labels.css`) and the related rows (`card.css`) come with the
 * plugin's blocks, through their `block.json`, only where they render; the collection templates
 * (`archive-resource.html`, `taxonomy-resource_type.html` and `taxonomy-resource_topic.html`, which
 * `is_post_type_archive( 'resource' )` and `is_tax()` on the two taxonomies pick out) load
 * `listing.css`, with the theme's own `assets/pagination.css` inline after it, and the library's
 * first page `lead.css` too, the one page the plugin's `featured-lead` block renders on; every other
 * template, `page.html`, `singular.html` and `index.html`, renders the page's article and loads
 * `prose.css` and `page.css`.
 * The plugin's collection blocks name neither handle in their `block.json`: core enqueues every
 * registered block's style on the editor's admin page, and these handles would bring `base.css` and
 * the fallback faces there through their dependencies, where the blocks show placeholders. The enqueue
 * here is what loads them, whether or not a block rendered anything.
 *
 * **Core's pagination as the front end's.** The collection part renders core's `query-pagination`
 * block, whose markup is WordPress's own (the one accepted DOM difference from the front end's
 * `Pagination`), with the `rh-pagination` class on its `nav` so `listing.css` draws the rule above it.
 * `assets/pagination.css`, the theme's one stylesheet of its own, maps core's `.page-numbers`,
 * `.current`, `.dots`, previous and next classes to the declarations `listing.css` makes for
 * `.rh-pagination__link`, `[aria-current]`, `__gap` and `__step`, token for token, and is added inline
 * after `listing.css` (`wp_add_inline_style()`, as the admin-bar rule is), rather than copied into
 * `build/` and registered: the manifest lists copies of the package's files, and this is not one.
 *
 * **Core block styles that fight the body's.** Core enqueues each block's stylesheet as the block
 * renders, before `wp_head`, and six draw over what `prose.css` or `resource.css` gives the same elements, which the
 * front end, loading no core CSS, never shows: `wp-block-table` (a border on every side of every
 * cell, a 3 px rule under the head, a fixed table layout, the scroll on the figure rather than the
 * region), `wp-block-code` (the code inside the block set as a block that breaks spaces, not the
 * inset's inline code), `wp-block-separator` (its dots style: three dots, with the hairline's
 * border taken off `!important`),
 * `wp-block-quote` (the large style's own padding, margins and italic, right-aligned citation,
 * where the front end draws every quote as the one inset), `wp-block-image` (a margin under the
 * caption, and the alignment, sizing and lightbox rules, none of which the front end draws) and
 * `wp-block-post-featured-image` (its image at `width: 100%`, which stretches an image narrower than
 * the column, where `resource.css` keeps it at its own width up to the column's; its other rules are
 * margins, box sizing and a link's box that `resource.css` and `base.css` already set). They
 * are dequeued here, on the CMS's own pages only; the editor canvas keeps them. Without the image
 * stylesheet a lightbox's overlay would show, so those pages also render every image with its
 * lightbox off (`inc/image-lightbox.php`), as the front end shows it. `theme-parity.spec.js` holds
 * each element to `prose.css`, and a narrow featured image to `resource.css`. The other core block styles a body can bring set box sizing,
 * wrapping or classes an editor opts into, and stay. Core's button look is not a block stylesheet
 * but core's default `theme.json` element style, printed in the global styles both the pages and the
 * canvas share, so it is not removed here: a button block is a filled button on the CMS and a link
 * on the front end (the theme's README, "Not built yet").
 */
function resource_hub_theme_enqueue_page_styles(): void {
	wp_enqueue_style( 'resource-hub-base' );
	wp_enqueue_style( 'resource-hub-shell' );
	wp_add_inline_style( 'resource-hub-shell', RESOURCE_HUB_THEME_ADMIN_BAR_SHELL );

	if ( resource_hub_theme_has_control() ) {
		wp_enqueue_style( 'resource-hub-theme-toggle' );
	} else {
		wp_add_inline_style( 'resource-hub-shell', RESOURCE_HUB_THEME_NO_CONTROL );
	}

	if ( is_404() ) {
		wp_enqueue_style( 'resource-hub-not-found' );
	} elseif ( is_home() ) {
		wp_enqueue_style( 'resource-hub-welcome' );
	} elseif ( is_singular( 'resource' ) ) {
		wp_enqueue_style( 'resource-hub-prose' );
		wp_enqueue_style( 'resource-hub-resource' );
		wp_enqueue_style( 'resource-hub-related' );
	} elseif ( resource_hub_theme_is_collection() ) {
		wp_enqueue_style( 'resource-hub-listing' );
		wp_add_inline_style( 'resource-hub-listing', resource_hub_theme_pagination_css() );

		if ( is_post_type_archive( 'resource' ) && ! is_paged() ) {
			wp_enqueue_style( 'resource-hub-lead' );
		}
	} else {
		wp_enqueue_style( 'resource-hub-prose' );
		wp_enqueue_style( 'resource-hub-page' );
	}

	foreach ( array( 'wp-block-table', 'wp-block-code', 'wp-block-separator', 'wp-block-quote', 'wp-block-image', 'wp-block-post-featured-image' ) as $handle ) {
		wp_dequeue_style( $handle );
	}
}
add_action( 'wp_enqueue_scripts', 'resource_hub_theme_enqueue_page_styles', 20 );

/**
 * Whether the request is a collection page: the resource archive, or a type or topic archive.
 *
 * The same test the plugin's `Collection::is_collection()` makes of the main query, for the templates
 * `archive-resource.html`, `taxonomy-resource_type.html` and `taxonomy-resource_topic.html`.
 */
function resource_hub_theme_is_collection(): bool {
	return is_post_type_archive( 'resource' ) || is_tax( array( 'resource_type', 'resource_topic' ) );
}

/**
 * The theme's `assets/pagination.css`: core's pagination block drawn as the front end's (see
 * {@see resource_hub_theme_enqueue_page_styles()}), or nothing when the file is missing.
 */
function resource_hub_theme_pagination_css(): string {
	$file = __DIR__ . '/assets/pagination.css';

	if ( ! is_readable( $file ) ) {
		return '';
	}

	$css = file_get_contents( $file ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- The theme's own file, by a path built from __DIR__, never a remote URL.

	return is_string( $css ) ? $css : '';
}

// On a page core renders with a template: each core/table block in the front end's scroll region,
// and each image block without its lightbox.
add_action( 'template_redirect', 'resource_hub_theme_add_table_regions' );
add_action( 'template_redirect', 'resource_hub_theme_add_lightbox_off' );

// The theme control's script, inline in <head> before core prints the stylesheets at 8, so a stored
// choice is applied before anything is painted (`inc/theme-control.php`).
add_action( 'wp_head', 'resource_hub_theme_print_control_script', 1 );
