<?php
/**
 * The `resource-hub/related` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\ContentModel\PostType;
use ResourceHub\Rest\RelatedItems;
use WP_Block;
use WP_Post;
use WP_Query;

/**
 * The resource page's related section, for the CMS theme's single-resource template.
 *
 * The front end's `RelatedSection` (`apps/web/components/RelatedSection.tsx`) reads the related route
 * for the page's resource and renders `RelatedList` (`RelatedList.tsx`): a heading over the rows of
 * `card.css`, the editor's picks first and then the newest resources sharing a topic. This block writes
 * the same section on the CMS from the same selection, {@see RelatedItems}, which the route answers
 * from too, at the count the front end asks for (`RelatedItems::DEFAULT_COUNT`), so the CMS's preview
 * and the site recommend the same resources in the same order from one cache entry.
 *
 *     <section class="rh-related" aria-labelledby="rh-related-heading">
 *       <h2 class="rh-related__heading" id="rh-related-heading">Related resources</h2>
 *       <ul class="rh-card-grid" role="list">
 *         <li>…ResourceCardMarkup::row() at h3…</li>…
 *       </ul>
 *     </section>
 *
 * - **Which post.** The `postId` and `postType` context, which `render_block()` sets from the global post
 *   in a single template and the editor's preview sends as the post being edited (`ContextResource::from()`).
 *   Anything but a published resource renders nothing, even in a preview the article's other blocks render
 *   for: `RelatedItems` caches the selection under the host's ID in the entry the public related route
 *   serves, and the route answers only for published hosts, so a host that is not published never reaches
 *   it and nothing about a draft's relations is computed or stored for the public read.
 * - **The rows.** The selection's IDs are read as posts in its order, published resources only, as the
 *   front end reads them with `include=…&orderby=include` (`getResourcesByIds`); one no longer published
 *   between the cache and the render is left out, as that read would leave it out. A resource whose title
 *   is empty as plain text, or that does not have exactly one type, gets no row (`toRelatedCard` on the
 *   front end: a related row is a recommendation, and "Untitled resource" recommends nothing), so the
 *   section can show fewer rows than the selection named, and nothing at all when none is left or the
 *   selection is empty, as the front end renders nothing then. No second read fills the gap, as none does
 *   on the front end. Each row is `ResourceCardMarkup::row()` at `h3`, under the section's `h2`, as
 *   `RelatedList` gives its rows the level under its heading; that class's docblock has the row's rules.
 * - **The heading** is the front end's `RELATED_HEADING`, "Related resources", in plain English rather
 *   than `esc_html__()`, so the two sites' markup is the same, and its `id` is the front end's
 *   `RELATED_HEADING_ID`, which names the section as a region through `aria-labelledby`; one section per
 *   page, so one id.
 * - **No wrapper.** The output is the `<section>` alone, with no block wrapper attributes
 *   (`supports.className` and `customClassName` are off), so it is the front end's markup exactly. The
 *   contract's markup fixture `related.html` holds it to `RelatedList` (`packages/ui/README.md`, "Markup
 *   fixtures"; `MarkupParityTest`).
 * - **Styles.** `block.json` lists the two shared handles the row blocks share, `resource-hub-tokens` and
 *   then `resource-hub-card` (`SharedTokens`, `SharedCard`), so the rows are styled wherever the block
 *   renders them, in the editor canvas included. The section's own rules, `related.css` (the heading on
 *   its strong rule, the section's margin), are the theme's: the single-resource template is the one
 *   place the section renders, and the same file draws the heading of a related-resources block in the
 *   resource's body, which only the theme can load for the page, so the theme registers and enqueues it
 *   from its manifest, and the plugin keeps no copy.
 *
 * Registered from `build/related/`, so without a build the block is not registered.
 */
final class RelatedBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/related';

	/**
	 * The section's heading: the front end's `RELATED_HEADING`.
	 */
	public const HEADING = 'Related resources';

	/**
	 * The heading's `id`, which `aria-labelledby` names: the front end's `RELATED_HEADING_ID`.
	 */
	public const HEADING_ID = 'rh-related-heading';

	/**
	 * The selection the section renders.
	 *
	 * @var RelatedItems
	 */
	private RelatedItems $items;

	/**
	 * Constructor.
	 *
	 * @param RelatedItems $items The selection the related route answers from.
	 */
	public function __construct( RelatedItems $items ) {
		$this->items = $items;
	}

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/related/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/related';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the context's resource's related section, or nothing.
	 *
	 * @param array<string, mixed> $attributes The block's attributes; it has none.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$post = ContextResource::from( $block );

		if ( null === $post ) {
			return '';
		}

		$ids = array_column( $this->items->for_resource( $post, RelatedItems::DEFAULT_COUNT ), 'id' );

		if ( array() === $ids ) {
			return '';
		}

		$rows = '';

		foreach ( self::published( $ids ) as $related ) {
			$title = ResourceCardMarkup::title( $related );
			$type  = ResourceCardMarkup::type( $related );

			if ( null !== $title && null !== $type ) {
				$rows .= '<li>' . ResourceCardMarkup::row( $related, $title, $type, 'h3' ) . '</li>';
			}
		}

		if ( '' === $rows ) {
			return '';
		}

		return '<section class="rh-related" aria-labelledby="' . esc_attr( self::HEADING_ID ) . '">'
			. '<h2 class="rh-related__heading" id="' . esc_attr( self::HEADING_ID ) . '">' . esc_html( self::HEADING ) . '</h2>'
			. '<ul class="rh-card-grid" role="list">' . $rows . '</ul>'
			. '</section>';
	}

	/**
	 * The published resources among `$ids`, in that order, with their terms and meta primed in one
	 * query each, as the front end's `include=…&orderby=include` read returns them.
	 *
	 * @param int[] $ids The selection's post IDs, at most `RelatedItems::MAX_COUNT`.
	 * @return WP_Post[]
	 */
	private static function published( array $ids ): array {
		$query = new WP_Query(
			array(
				'post_type'           => PostType::NAME,
				'post_status'         => 'publish',
				'post__in'            => $ids,
				'orderby'             => 'post__in',
				'posts_per_page'      => count( $ids ),
				'no_found_rows'       => true,
				'ignore_sticky_posts' => true,
			)
		);

		return array_values( array_filter( $query->posts, static fn( $post ): bool => $post instanceof WP_Post ) );
	}
}
