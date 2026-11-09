<?php
/**
 * The `resource-hub/page-card` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\Pages\PagePath;
use WP_Block;
use WP_Post;

/**
 * One page as the front end's search-result row, for a `core/post-template` that lists pages among
 * resources: the CMS theme's `search.html`.
 *
 * The front end's search page renders a page with `PageCard` (`apps/web/components/PageCard.tsx`): the
 * resource row's shape with a page's own meta line, the label "Page" in place of the type and the date,
 * and the excerpt as the summary, with no topics (`packages/ui/DESIGN.md`, "A page in a mixed list").
 * This block writes it with the same renderer as the other rows (`ResourceCardMarkup::page_row()`, whose
 * docblock has the markup and the text rules), so a logged-in preview of a search lists the site's rows.
 * The search template puts it in the post template beside `resource-hub/resource-card`: each block
 * renders for its own post type and nothing for the other's, so each result gets one row.
 *
 * - **Which post.** The `postId` and `postType` context the post template sets. Anything but a published
 *   page renders nothing: the front end lists only published pages, and a loop is not limited to them by
 *   itself (`ContextResource`'s reasoning). A page the front end would give no URL (a reserved first
 *   segment, say) has none on the CMS either, since `ReservedPageSlugs` keeps those slugs out.
 * - **The heading level** is the `level` attribute, 2 to 4, `PageCard`'s `headingLevel`, clamped as
 *   `ResourceCardBlock` clamps it.
 * - **No wrapper.** The output is the `<article class="rh-card">` alone, with no block wrapper attributes.
 * - **Styles.** `block.json` lists `resource-hub-tokens` and then `resource-hub-card`, the shared handles
 *   the `resource-card` block lists, so a page with both loads the row's rules once.
 *
 * The contract's page fixtures (`packages/ui/fixtures/markup/page/`) hold this block and the front end's
 * `PageCard` to the same HTML (`MarkupParityTest`).
 *
 * Registered from `build/page-card/`, so without a build the block is not registered.
 */
final class PageCardBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/page-card';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/page-card/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/page-card';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the context's page as a row, or nothing.
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$post = self::page( $block );

		if ( null === $post ) {
			return '';
		}

		return ResourceCardMarkup::page_row( $post, 'h' . ResourceCardBlock::clamp_level( $attributes['level'] ?? ResourceCardBlock::DEFAULT_LEVEL ) );
	}

	/**
	 * The published page the block's context names, or null.
	 *
	 * @param WP_Block $block The block being rendered.
	 */
	private static function page( WP_Block $block ): ?WP_Post {
		$id   = $block->context['postId'] ?? 0;
		$type = $block->context['postType'] ?? PagePath::POST_TYPE;

		if ( PagePath::POST_TYPE !== $type || ! is_numeric( $id ) || (int) $id <= 0 ) {
			return null;
		}

		$post = get_post( (int) $id );

		return $post instanceof WP_Post && PagePath::POST_TYPE === $post->post_type && 'publish' === $post->post_status ? $post : null;
	}
}
