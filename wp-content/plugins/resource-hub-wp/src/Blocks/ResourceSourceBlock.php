<?php
/**
 * The `resource-hub/resource-source` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use WP_Block;

/**
 * The resource page's source line, for the CMS theme's single-resource template.
 *
 * The front end's `ResourceArticle` renders `meta.source_url` under the body as "Source:" and a link shown
 * by its host, or by its file name for an upload, in `<footer class="rh-resource__source">`, and nothing
 * when the resource has no source or its URL is one the front end will not link. Core's blocks cannot write
 * the line (a button bound to the meta is a button, and the label is computed from the URL), so this block
 * does, with `ResourceCardMarkup::source()`, whose class docblock has every rule of the link.
 *
 * - **Which post.** The `postId` and `postType` context (`ContextResource`), as the meta block reads it.
 *   Anything but a published resource renders nothing, and so does a resource without exactly one type,
 *   which the front end does not render at all, so the three article blocks agree on when they render.
 * - **No wrapper.** The output is the `<footer>` alone, with no block wrapper attributes, so it is the
 *   front end's markup exactly.
 * - **No stylesheet.** The line's rule is the article's, in `resource.css`, which the template that renders
 *   the article loads.
 *
 * Registered from `build/resource-source/`, so without a build the block is not registered.
 */
final class ResourceSourceBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/resource-source';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/resource-source/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/resource-source';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the context's resource's source line, or nothing.
	 *
	 * @param array<string, mixed> $attributes The block's attributes; it has none.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$post = ContextResource::from( $block );

		return null === $post || null === ResourceCardMarkup::type( $post ) ? '' : ResourceCardMarkup::source( $post );
	}
}
