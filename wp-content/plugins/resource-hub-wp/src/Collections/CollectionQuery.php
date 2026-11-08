<?php
/**
 * The collection pages' main query and the lead's effect on their list.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Collections;

use ResourceHub\Blocks\ResourceCardBlock;
use ResourceHub\ContentModel\Taxonomies;
use WP_HTML_Tag_Processor;
use WP_Post;
use WP_Query;
use WP_Term;

/**
 * Makes the CMS's collection pages paginate and list as the front end's do (`apps/web/components/ListingPage.tsx`).
 *
 * The theme's collection templates render the main query through `core/query` with `inherit`, so what
 * the page lists is what the main query finds. Three things about that list are the front end's and
 * not core's defaults, and this sets them on the main query of a collection ({@see Collection}):
 *
 * - **Twelve to a page** (`Collection::PER_PAGE`), the front end's `RESOURCES_PER_PAGE`, in place of
 *   Settings > Reading's count, on `pre_get_posts`, so the two sites' pages hold the same resources
 *   and `/page/{n}/` means the same page on both.
 * - **The lead is left out of the rows under it.** On the library's first page the front end shows the
 *   newest featured resource as the lead and drops its row from the list, so a resource is linked once
 *   per page, while the count and the pagination stay the CMS's: page 1 holds eleven rows under the
 *   lead. The `the_posts` filter removes the lead's post from the main query's page when it falls on
 *   it, after `found_posts` and `max_num_pages` are set, so they do not move; a lead whose own place is
 *   on a later page appears there as a row, as on the front end.
 * - **The list sits under "Latest", its rows a level down.** With a lead, the front end heads the list
 *   `<h2 class="rh-listing__section">Latest</h2>` inside `<div class="rh-listing__latest">` and sets
 *   its rows' titles at `h3`; without one the rows sit under the `h1` as `h2`s. On the page that shows
 *   a lead and has rows left under it, the inheriting `core/query` block's wrapper (its saved `<div>`,
 *   which core renders as written) takes the `rh-listing__latest` class and the heading as its first
 *   child, through `render_block_core/query`, and every `resource-hub/resource-card` block on the
 *   page renders one level down from its `level` attribute, through `render_block_data`. The template
 *   keeps the lead-less markup (`level` 2, no heading) and the lead decides the rest, as it does on the
 *   front end. Nothing else on that page lists rows, so every row on it is the list's. With the lead
 *   the page's only resource, there are no rows, and the front end shows no list and no heading; the
 *   wrapper stays as written and the `collection-empty` block renders nothing beside a lead.
 * - **A term that does not exist is a 404.** The front end answers a type or topic segment that names
 *   no term with a 404. Core does too when the request names one taxonomy, but for a type within a
 *   topic it keeps the term that exists as the queried object and answers 200 with no posts, so the
 *   `pre_handle_404` filter makes a collection whose `resource_type` or `resource_topic` names no term
 *   the 404 core would send, after the lockdown has had its say (ADR 0031).
 *
 * A template that puts the list in a `core/query` of its own (`inherit` false) gets none of this, as
 * `tests/e2e/resource-card-block.spec.js`'s page does not. The empty state and the "can't be shown"
 * state are the `resource-hub/collection-empty` block's and the front end's alone.
 */
final class CollectionQuery {
	/**
	 * The heading over the list when the lead shows, the front end's text.
	 */
	public const LATEST = 'Latest';

	/**
	 * Hooks the three effects.
	 */
	public function register(): void {
		add_action( 'pre_get_posts', array( $this, 'set_per_page' ) );
		add_filter( 'the_posts', array( $this, 'drop_the_lead' ), 10, 2 );
		add_filter( 'pre_handle_404', array( $this, 'missing_term_is_404' ), 1, 2 );
		add_filter( 'render_block_data', array( $this, 'lower_the_rows' ) );
		add_filter( 'render_block_core/query', array( $this, 'head_the_list' ), 10, 2 );
	}

	/**
	 * Twelve resources to a page on a collection's main query. Hooked to `pre_get_posts`.
	 *
	 * @param WP_Query $query The query being set up.
	 */
	public function set_per_page( WP_Query $query ): void {
		if ( is_admin() || ! $query->is_main_query() || ! Collection::is_collection( $query ) ) {
			return;
		}

		$query->set( 'posts_per_page', Collection::PER_PAGE );
	}

	/**
	 * Removes the lead's post from the library's first page, keeping the count and the page numbers. Hooked to `the_posts`.
	 *
	 * @param WP_Post[]|mixed $posts The page's posts.
	 * @param WP_Query        $query The query that found them.
	 * @return WP_Post[]|mixed The posts without the lead's.
	 */
	public function drop_the_lead( $posts, WP_Query $query ) {
		if ( ! is_array( $posts ) || is_admin() || ! $query->is_main_query() ) {
			return $posts;
		}

		$collection = Collection::from( $query );

		if ( null === $collection || ! $collection->is_library_front() ) {
			return $posts;
		}

		$lead = Lead::for( $collection );

		if ( null === $lead ) {
			return $posts;
		}

		return array_values( array_filter( $posts, static fn ( $post ): bool => ! ( $post instanceof WP_Post ) || $post->ID !== $lead->ID ) );
	}

	/**
	 * A collection whose type or topic names no term is a 404, as on the front end. Hooked to `pre_handle_404` at priority 1.
	 *
	 * @param mixed    $preempt Whether an earlier callback already handled the request.
	 * @param WP_Query $query   The main query.
	 * @return mixed True once the request is a 404; `$preempt` unchanged otherwise.
	 */
	public function missing_term_is_404( $preempt, $query ) {
		if ( false !== $preempt || ! $query instanceof WP_Query || $query->is_404() || ! Collection::is_collection( $query ) ) {
			return $preempt;
		}

		foreach ( array( Taxonomies::TYPE, Taxonomies::TOPIC ) as $taxonomy ) {
			$slug = $query->get( $taxonomy );

			if ( is_string( $slug ) && '' !== $slug && ! get_term_by( 'slug', $slug, $taxonomy ) instanceof WP_Term ) {
				// What core's `handle_404()` does for a path that matched nothing.
				$query->set_404();
				status_header( 404 );
				nocache_headers();

				return true;
			}
		}

		return $preempt;
	}

	/**
	 * On the page that shows a lead, each row's title drops a level. Hooked to `render_block_data`.
	 *
	 * @param array<string, mixed>|mixed $parsed_block The block about to render.
	 * @return array<string, mixed>|mixed The block, adjusted.
	 */
	public function lower_the_rows( $parsed_block ) {
		if ( ! is_array( $parsed_block ) || ResourceCardBlock::NAME !== ( $parsed_block['blockName'] ?? null ) || null === Lead::current() ) {
			return $parsed_block;
		}

		$parsed_block['attrs']['level'] = ResourceCardBlock::clamp_level( $parsed_block['attrs']['level'] ?? ResourceCardBlock::DEFAULT_LEVEL ) + 1;

		return $parsed_block;
	}

	/**
	 * On the page that shows a lead over a list, the inheriting query block's wrapper takes the list's class and the "Latest" heading as its first child. Hooked to `render_block_core/query`.
	 *
	 * @param string|mixed         $content The block's rendered wrapper and list.
	 * @param array<string, mixed> $block   The parsed block.
	 * @return string|mixed The content, headed.
	 */
	public function head_the_list( $content, array $block ) {
		if ( ! is_string( $content ) || ! self::inherits( $block ) || ! self::lead_over_rows() ) {
			return $content;
		}

		$processor = new WP_HTML_Tag_Processor( $content );

		if ( ! $processor->next_tag() || 'DIV' !== $processor->get_tag() ) {
			return $content;
		}

		$processor->add_class( 'rh-listing__latest' );
		$content = $processor->get_updated_html();
		$open    = strpos( $content, '>' );

		if ( false === $open ) {
			return $content;
		}

		return substr( $content, 0, $open + 1 ) . '<h2 class="rh-listing__section">' . esc_html( self::LATEST ) . '</h2>' . substr( $content, $open + 1 );
	}

	/**
	 * Whether the current page shows a lead with rows under it: the main query has posts left once the lead's is gone.
	 */
	private static function lead_over_rows(): bool {
		$query = $GLOBALS['wp_query'] ?? null;

		return $query instanceof WP_Query && $query->post_count > 0 && null !== Lead::current();
	}

	/**
	 * Whether a `core/query` block renders the main query.
	 *
	 * @param array<string, mixed> $block The parsed block.
	 */
	private static function inherits( array $block ): bool {
		return ! empty( $block['attrs']['query']['inherit'] );
	}
}
