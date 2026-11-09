<?php
/**
 * The `resource-hub/search-head` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\Rest\SearchRoute;
use ResourceHub\Search\SearchPath;
use ResourceHub\Search\SearchRequest;
use WP_Query;

/**
 * The search page's head, as the front end's `SearchPage` renders it before the rows: the heading, the
 * form and the count line, for the CMS theme's `search.html`.
 *
 * The front end's search page (`apps/web/components/SearchPage.tsx`; `packages/ui/DESIGN.md`, "The
 * search page") opens with `<header class="rh-listing__header"><h1>Search</h1></header>`, then its form
 * (`SearchForm`, `packages/ui/search.css`): a GET form to `/search/` in a `search` landmark, a visible
 * label, a `type="search"` field that shows the reader's words again, and a submit button. Core's search
 * block cannot write it (another markup, another label, no state on the field), so this block does, from
 * the main query through {@see SearchRequest}, and renders nothing on any request that is not a search page.
 *
 * - **The form** submits to the CMS's `/search/` ({@see SearchPath}) with core's query var, `s`, the one
 *   place the markup differs from the front end's `name="q"` by design; the field's `id` is the front
 *   end's `SEARCH_INPUT_ID`, `rh-search-q`, which the header's control links to on this page.
 * - **The field's state** is the request's: `value` is `s` as typed (the `invalid` kind's control
 *   characters removed); every kind but `none` names the page's sentence about the query with
 *   `aria-describedby="rh-search-message"`, the `id` the count line below or the `search-empty` block's
 *   first sentence carries; and the three kinds the front end refuses to search for mark the field
 *   `aria-invalid="true"`. No `required`, `minlength` or `maxlength`, as on the front end.
 * - **The count line**, `<p class="rh-search__summary" id="rh-search-message">`, only when the request
 *   searches and finds something: "1 result for “q”" or "{n} results for “q}", with the front end's
 *   sentence about the first 120 when the total passes what the route lists. The total is the main
 *   query's `found_posts`, which {@see \ResourceHub\Search\MainSearchQuery} keeps true on a later page.
 * - **Text** is escaped as the front end escapes React text, through {@see ResourceCardMarkup::text_html()};
 *   "Search", the label and the sentences are plain English, not translated, as the front end hard-codes
 *   them.
 * - **No wrapper.** The output is the header, the form and the count line, with no block wrapper
 *   attributes, so it is the front end's markup exactly.
 * - **Styles.** `block.json` lists the shared `resource-hub-tokens` handle alone. The head's rules are the
 *   package's `listing.css` and `search.css`, which the CMS theme enqueues on its search template
 *   (`functions.php`), not a handle named here (see {@see CollectionHeadBlock} for why).
 *
 * The contract's search fixtures (`packages/ui/fixtures/markup/search/`) hold this block and the front
 * end's `SearchPage` to the same HTML for a few scenes (`MarkupParityTest`), with the query var's name
 * and the form's origin normalised.
 *
 * Registered from `build/search-head/`, so without a build the block is not registered.
 */
final class SearchHeadBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/search-head';

	/**
	 * The field's `id`, the front end's `SEARCH_INPUT_ID` (`apps/web/lib/search-field.ts`).
	 */
	public const INPUT_ID = 'rh-search-q';

	/**
	 * The `id` of the page's sentence about the query, the front end's `MESSAGE_ID`.
	 */
	public const MESSAGE_ID = 'rh-search-message';

	/**
	 * The field's visible label, the front end's.
	 */
	public const LABEL = 'Search resources and pages';

	/**
	 * The most matches the route lists: ten pages of twelve, the front end's `MAX_LISTED`.
	 */
	public const MAX_LISTED = SearchRoute::MAX_PAGE * SearchRoute::PER_PAGE;

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/search-head/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/search-head';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the current search page's head, or nothing.
	 */
	public function render(): string {
		$request = SearchRequest::current();

		if ( null === $request ) {
			return '';
		}

		$query = $GLOBALS['wp_query'] ?? null;

		return self::head( $request, $query instanceof WP_Query ? max( 0, (int) $query->found_posts ) : 0 );
	}

	/**
	 * The head for `$request`: the heading, the form and, for a search that found something, the count line.
	 *
	 * @param SearchRequest $request The request.
	 * @param int           $total   Matches across every page, when the request searches.
	 */
	public static function head( SearchRequest $request, int $total ): string {
		$html  = '<header class="rh-listing__header"><h1>Search</h1></header>';
		$html .= self::form( $request );

		if ( $request->searches() && $total > 0 ) {
			$line = ( 1 === $total ? '1 result' : $total . ' results' ) . ' for ' . $request->quoted();

			if ( $total > self::MAX_LISTED ) {
				$line .= '. The first ' . self::MAX_LISTED . ' are listed; add words to narrow the search.';
			}

			$html .= '<p class="rh-search__summary" id="' . self::MESSAGE_ID . '">' . ResourceCardMarkup::text_html( $line ) . '</p>';
		}

		return $html;
	}

	/**
	 * The form, the front end's `SearchForm` with the CMS's action and query var.
	 *
	 * The attributes are in the order React DOM writes them, which puts an input's `name` and `value` last
	 * whatever the JSX order: `defaultValue` renders as `value`, `enterKeyHint` as `enterkeyhint`, and the
	 * two state attributes are left out, not emptied, when they do not apply.
	 *
	 * @param SearchRequest $request The request.
	 */
	public static function form( SearchRequest $request ): string {
		$html  = '<form class="rh-search" role="search" action="' . esc_url( home_url( '/' . SearchPath::BASE . '/' ) ) . '" method="get">';
		$html .= '<label class="rh-search__label" for="' . self::INPUT_ID . '">' . self::LABEL . '</label>';
		$html .= '<div class="rh-search__row">';
		$html .= '<input class="rh-search__input" id="' . self::INPUT_ID . '" type="search" enterkeyhint="search"';

		if ( $request->describes() ) {
			$html .= ' aria-describedby="' . self::MESSAGE_ID . '"';
		}

		if ( $request->invalid() ) {
			$html .= ' aria-invalid="true"';
		}

		$html .= ' name="s" value="' . ResourceCardMarkup::text_html( $request->input ) . '"/>';
		$html .= '<button class="rh-search__button" type="submit">Search</button>';

		return $html . '</div></form>';
	}
}
