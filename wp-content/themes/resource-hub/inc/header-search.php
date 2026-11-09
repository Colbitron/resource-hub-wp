<?php
/**
 * The header's search control on the CMS's own pages.
 *
 * The front end's header ends its row with a search control (`packages/ui/DESIGN.md`, "The header's
 * search control"; issue #115): without JavaScript a plain link to `/search/` named "Search", and with it
 * a disclosure button that opens a bar under the header holding the search page's own form. The owner
 * chose full parity for logged-in previews, and to keep the control's current design until issue #128
 * redesigns it on both sites, so the theme's header part (`parts/header.html`) holds the link's markup in
 * a Custom HTML block, byte for byte the front end's server render, which the contract's `header-search.html`
 * fixture holds both to (`packages/ui/README.md`, "Markup fixtures").
 *
 * The behaviour is the theme's own script, `js/header-search.js`, since the package shares no JavaScript
 * (`DESIGN.md`, "Do's and Don'ts"): the front end's `HeaderSearch` written again in one small file. This
 * file prints it inline at the end of the body, on `wp_footer`, through `wp_print_inline_script_tag()`,
 * so a Content Security Policy added later can hash it (the script is a fixed file) and a nonce plugin can
 * add its attribute through `wp_inline_script_attributes`. The script's two inputs travel as `data-`
 * attributes on its own tag, which it reads back by the tag's `id`: the form's action, the CMS's
 * `/search/` (the plugin's `SearchPath` rule puts core's search there, with core's `s` as the query var),
 * and the URLs of the bar's two stylesheets, the package's `header-search-bar.css` and `search.css`, which
 * `functions.php` registers from the theme's manifest and the script adds to the page only when a reader
 * is about to open the bar, as the front end imports them on demand; the button's own `header-search.css`
 * loads with the page. In the footer rather than the head: nothing here must run before the first paint,
 * and the link works until the script does.
 *
 * On the search page the control stays a link, to the page's own field (`#rh-search-q`), and the script
 * focuses that field, as on the front end, where a second form would be two fields named `q` and two
 * `search` landmarks for one task. The part is one file, so the link's `href` is `/search/` as written;
 * {@see resource_hub_theme_header_search_page_link()} rewrites it on the search page as core renders the
 * block, so the HTML a reader without script gets is the front end's there too.
 *
 * The 404 is the one template without the control, as it is the one without the theme control
 * (`inc/theme-control.php`): it is the page every anonymous visitor gets (the plugin's lockdown, ADR 0031),
 * `/search/` is a 404 for them as every theme page is, and the 404 already leaves out the front end's
 * "Browse all resources" link for the same reason. So the 404 loads no script and no `header-search.css`,
 * and `functions.php` hides the control's slot with the rule below, inline after `shell.css`; the shared
 * header part still carries the hidden markup there, and a logged-in user who reaches a real 404 has the
 * lockup to leave by.
 *
 * This file only defines functions; `functions.php` hooks them, and the plugin's PHPUnit suite loads
 * this file alone to test them (`tests/phpunit/Theme/ThemeHeaderSearchTest.php`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The rule that removes the control from the header's row on the 404, which has no control: the header
 * is laid out as the front end's would be without one, the lockup alone at the row's height.
 */
const RESOURCE_HUB_THEME_NO_HEADER_SEARCH = '.rh-header-search{display:none}';

/**
 * The `id` of the inline script tag, which the script reads its `data-` attributes from.
 */
const RESOURCE_HUB_THEME_HEADER_SEARCH_SCRIPT_ID = 'resource-hub-header-search-js';

/**
 * The handles of the bar's stylesheets, in the order the front end loads them, registered from the
 * theme's manifest (`scripts/build.mjs`) and added to the page by the script when the bar is about to open.
 */
const RESOURCE_HUB_THEME_HEADER_SEARCH_BAR_STYLES = array( 'resource-hub-header-search-bar', 'resource-hub-search' );

/**
 * Whether the page core is rendering has the control: every template but the 404.
 */
function resource_hub_theme_has_header_search(): bool {
	return ! is_404();
}

/**
 * The theme's script, `js/header-search.js`, as printed inline; an empty string when the file cannot be
 * read, so the page keeps the link rather than a broken tag (see `resource_hub_theme_control_script()`
 * for the reading rules, which are the same).
 *
 * @param string $file The script's path; the theme's own file unless a test names another.
 */
function resource_hub_theme_header_search_script( string $file = '' ): string {
	if ( '' === $file ) {
		$file = dirname( __DIR__ ) . '/js/header-search.js';
	}

	if ( ! is_file( $file ) || ! is_readable( $file ) ) {
		return '';
	}

	$script = file_get_contents( $file ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local file just checked with is_file(), never a URL, read as core reads a block theme's templates.

	return is_string( $script ) ? $script : '';
}

/**
 * The bar's stylesheets as the script adds them: each registered handle with its versioned URL, as core
 * would print it, in the order they load. A handle the manifest does not register (no build) is left out,
 * and the bar then opens unstyled rather than not at all.
 *
 * @return array<string, string>
 */
function resource_hub_theme_header_search_styles(): array {
	$registered = wp_styles()->registered;
	$styles     = array();

	foreach ( RESOURCE_HUB_THEME_HEADER_SEARCH_BAR_STYLES as $handle ) {
		$style = $registered[ $handle ] ?? null;

		if ( ! $style instanceof _WP_Dependency || ! is_string( $style->src ) || '' === $style->src ) {
			continue;
		}

		$styles[ $handle ] = is_string( $style->ver ) && '' !== $style->ver ? add_query_arg( 'ver', $style->ver, $style->src ) : $style->src;
	}

	return $styles;
}

/**
 * Prints the control's script inline, with the form's action and the bar's stylesheets as its `data-`
 * attributes, on `wp_footer`, on every page with the control.
 */
function resource_hub_theme_print_header_search_script(): void {
	if ( ! resource_hub_theme_has_header_search() ) {
		return;
	}

	$script = resource_hub_theme_header_search_script();
	if ( '' === $script ) {
		return;
	}

	wp_print_inline_script_tag(
		$script,
		array(
			'id'          => RESOURCE_HUB_THEME_HEADER_SEARCH_SCRIPT_ID,
			'data-action' => home_url( '/search/' ),
			'data-styles' => (string) wp_json_encode( resource_hub_theme_header_search_styles() ),
		)
	);
}

/**
 * On the search page, the control's link goes to the page's own field, as the front end's does there.
 * Hooked to `render_block_core/html`: the control is the header part's second Custom HTML block.
 *
 * @param string|mixed $content The block's rendered HTML.
 * @return string|mixed The HTML, with the link's target the field on the search page.
 */
function resource_hub_theme_header_search_page_link( $content ) {
	if ( ! is_string( $content ) || ! is_search() || ! str_contains( $content, 'class="rh-header-search"' ) ) {
		return $content;
	}

	return str_replace( ' href="/search/"', ' href="#rh-search-q"', $content );
}
