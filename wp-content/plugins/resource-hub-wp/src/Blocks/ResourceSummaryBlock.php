<?php
/**
 * The `resource-hub/resource-summary` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use WP_Block;

/**
 * The resource page's lead paragraph, the summary, for the CMS theme's single-resource template.
 *
 * The front end's `ResourceArticle` renders the summary as `<p class="rh-resource__summary">` between the
 * featured image and the body, and nothing when the summary is empty once its whitespace is collapsed. A
 * block rather than a paragraph bound to the `summary` meta: a binding keeps its empty `<p>`, with the
 * paragraph's margin, when the meta is empty, and inserts the value through core's rich-text path, where
 * this writes the text as React would (`ResourceCardMarkup::summary()`, whose class docblock has the rule).
 *
 * - **Which post.** The `postId` and `postType` context (`ContextResource`), as the meta block reads it.
 *   Anything but a published resource renders nothing, and so does a resource without exactly one type,
 *   which the front end does not render at all, so the three article blocks agree on when they render.
 * - **No wrapper.** The output is the `<p>` alone, with no block wrapper attributes, so it is the front
 *   end's markup exactly. The contract's markup fixtures hold it to `ResourceArticle` (`{case}.summary.html`;
 *   `MarkupParityTest`).
 * - **No stylesheet.** The paragraph's rule is the article's, in `resource.css`, which the template that
 *   renders the article loads; the block needs no tokens of its own.
 *
 * Registered from `build/resource-summary/`, so without a build the block is not registered.
 */
final class ResourceSummaryBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/resource-summary';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/resource-summary/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/resource-summary';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the context's resource's summary paragraph, or nothing.
	 *
	 * @param array<string, mixed> $attributes The block's attributes; it has none.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$post = ContextResource::from( $block );

		return null === $post || null === ResourceCardMarkup::type( $post ) ? '' : ResourceCardMarkup::summary( $post );
	}
}
