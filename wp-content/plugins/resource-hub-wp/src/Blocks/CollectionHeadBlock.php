<?php
/**
 * The `resource-hub/collection-head` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\Collections\Collection;
use ResourceHub\ContentModel\Taxonomies;
use WP_Term;

/**
 * A collection page's header and filter bar, as the front end's `ListingPage` and `FilterNav` render them, for the CMS theme's collection templates.
 *
 * The front end's listing opens with the heading and the count on one line, then two rows of filter
 * links between hairlines (`packages/ui/DESIGN.md`, "The collection pages", "The filters";
 * `apps/web/components/ListingSections.tsx` and `FilterNav.tsx`). Core's blocks cannot write it (the
 * heading's wording from two terms, the count, a filter row that keeps the other dimension), so this
 * block does, from the main query ({@see Collection}), and the CMS's logged-in previews show the site's
 * head. It renders nothing on any request that is not a collection.
 *
 * - **The heading** names the collection as the front end's `heading()` does, term names as the editor
 *   wrote them, never pluralised: "Resources", "Webinar resources", "Resources on Accessibility",
 *   "Webinar resources on Accessibility". It carries the front end's `id` and `tabindex="-1"`, which its
 *   `ListingFocus` moves focus to after a client navigation; the CMS has no client navigation, and the
 *   attributes are harmless, so the markup stays the same.
 * - **The count**, "1 resource" or "{n} resources", in `rh-listing__count`, only when the collection has
 *   any (`listing.total > 0`), with the CMS's `found_posts` as `total`.
 * - **The filters**: one `nav` named "Filter resources" holding a group per taxonomy, each a small label
 *   ("Type", "Topic") and a list of links named by it. The first link clears that dimension ("All types",
 *   "All topics") and keeps the other; each term's link keeps the other dimension too, and every link
 *   goes back to page 1 (`ResourceCardMarkup::listing_url()`). The current term carries
 *   `aria-current="true"`, and so does "All" when nothing in that row is selected.
 * - **Which terms are offered**: every term with a published resource, in name order, plus the current
 *   term even when its count is zero, so the bar always shows what the page is filtered by; a term that
 *   can only lead to an empty page is not offered (`offered()` on the front end). The CMS reads
 *   `get_terms()` with empty terms included and the term's own `count`, the same field the REST API
 *   lists, which core keeps as the published resources carrying the term.
 * - **Text** is escaped as the front end escapes React text and term names are plain text, through the
 *   same helpers as the rows (`ResourceCardMarkup`). "Filter resources", "Type", "Topic", "All types",
 *   "All topics", "resource" and "resources" are plain English, not translated, as the front end hard-codes
 *   them and a translation would make the two sites' markup differ.
 * - **No wrapper.** The output is the `<header>` and the `<nav>`, with no block wrapper attributes, so it
 *   is the front end's markup exactly.
 * - **Styles.** `block.json` lists the shared `resource-hub-tokens` handle alone. The head's rules are the
 *   package's `listing.css`, which the CMS theme registers from its build and enqueues on its collection
 *   templates (`functions.php`), not a handle named here: core enqueues every registered block's style on
 *   the editor's admin page, around the canvas, and the theme's handle would bring `base.css` and the
 *   fallback faces with it there, where the block only shows a placeholder. In a theme that does not load
 *   `listing.css`, the head renders unstyled.
 *
 * The contract's collection fixtures (`packages/ui/fixtures/markup/collection/`) hold this block and the
 * front end's `CollectionHead` to the same HTML for a few scenes (`MarkupParityTest`).
 *
 * Registered from `build/collection-head/`, so without a build the block is not registered.
 */
final class CollectionHeadBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/collection-head';

	/**
	 * The heading's id, the front end's `HEADING_ID`.
	 */
	public const HEADING_ID = 'rh-listing-heading';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/collection-head/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/collection-head';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the current collection's head, or nothing.
	 */
	public function render(): string {
		$collection = Collection::current();

		return null === $collection ? '' : self::head( $collection );
	}

	/**
	 * The head for `$collection`.
	 *
	 * @param Collection $collection The collection.
	 */
	public static function head( Collection $collection ): string {
		$html  = '<header class="rh-listing__header">';
		$html .= '<h1 id="' . esc_attr( self::HEADING_ID ) . '" tabindex="-1">' . ResourceCardMarkup::text_html( self::heading( $collection ) ) . '</h1>';

		if ( $collection->total > 0 ) {
			$html .= '<p class="rh-listing__count">' . ResourceCardMarkup::text_html( self::count_line( $collection->total ) ) . '</p>';
		}

		$html .= '</header>';

		$type  = $collection->type?->slug;
		$topic = $collection->topic?->slug;

		$html .= '<nav class="rh-filters" aria-label="Filter resources">';
		$html .= self::group(
			'rh-filter-type',
			'Type',
			'All types',
			ResourceCardMarkup::listing_url( null, $topic ),
			self::offered( Taxonomies::TYPE, $type ),
			$type,
			static fn ( string $slug ): string => ResourceCardMarkup::listing_url( $slug, $topic )
		);
		$html .= self::group(
			'rh-filter-topic',
			'Topic',
			'All topics',
			ResourceCardMarkup::listing_url( $type, null ),
			self::offered( Taxonomies::TOPIC, $topic ),
			$topic,
			static fn ( string $slug ): string => ResourceCardMarkup::listing_url( $type, $slug )
		);

		return $html . '</nav>';
	}

	/**
	 * The collection's name, the front end's `heading()`.
	 *
	 * @param Collection $collection The collection.
	 */
	public static function heading( Collection $collection ): string {
		$head = null === $collection->type ? 'Resources' : ResourceCardMarkup::plain_text( $collection->type->name ) . ' resources';

		return null === $collection->topic ? $head : $head . ' on ' . ResourceCardMarkup::plain_text( $collection->topic->name );
	}

	/**
	 * The count line, the front end's `countLine()`.
	 *
	 * @param int $total Resources across every page.
	 */
	public static function count_line( int $total ): string {
		return 1 === $total ? '1 resource' : $total . ' resources';
	}

	/**
	 * The terms the filter bar offers for a taxonomy, in name order: each with a published resource, and the current one.
	 *
	 * @param string      $taxonomy `resource_type` or `resource_topic`.
	 * @param string|null $current  The slug the page is filtered by, or null.
	 * @return WP_Term[]
	 */
	public static function offered( string $taxonomy, ?string $current ): array {
		$terms = get_terms(
			array(
				'taxonomy'   => $taxonomy,
				'hide_empty' => false,
				'orderby'    => 'name',
				'order'      => 'ASC',
			)
		);

		if ( ! is_array( $terms ) ) {
			return array();
		}

		return array_values(
			array_filter(
				$terms,
				static fn ( $term ): bool => $term instanceof WP_Term && ( $term->count > 0 || $term->slug === $current )
			)
		);
	}

	/**
	 * One filter group: its label and its list of links, the front end's `FilterGroup`.
	 *
	 * @param string      $id       The label's id, which the list is named by.
	 * @param string      $name     The label.
	 * @param string      $all      The text of the link that clears the dimension.
	 * @param string      $all_href That link's URL.
	 * @param WP_Term[]   $terms    The terms offered.
	 * @param string|null $selected The slug that is current, or null.
	 * @param callable    $href_for The URL for a term's slug.
	 */
	private static function group( string $id, string $name, string $all, string $all_href, array $terms, ?string $selected, callable $href_for ): string {
		$html  = '<div class="rh-filters__group">';
		$html .= '<span class="rh-filters__name" id="' . esc_attr( $id ) . '">' . ResourceCardMarkup::text_html( $name ) . '</span>';
		$html .= '<ul class="rh-filters__list" aria-labelledby="' . esc_attr( $id ) . '" role="list">';
		$html .= '<li>' . self::link( $all_href, $all, null === $selected ) . '</li>';

		foreach ( $terms as $term ) {
			$html .= '<li>' . self::link( $href_for( $term->slug ), ResourceCardMarkup::plain_text( $term->name ), $term->slug === $selected ) . '</li>';
		}

		return $html . '</ul></div>';
	}

	/**
	 * One filter link, current or not.
	 *
	 * @param string $href    The URL.
	 * @param string $text    The link's text, plain.
	 * @param bool   $current Whether it is the current filter.
	 */
	private static function link( string $href, string $text, bool $current ): string {
		// `aria-current` before `href`, the order the front end's `<Link>` writes its attributes in.
		return '<a class="rh-filters__link"' . ( $current ? ' aria-current="true"' : '' ) . ' href="' . esc_url( $href ) . '">' . ResourceCardMarkup::text_html( $text ) . '</a>';
	}
}
