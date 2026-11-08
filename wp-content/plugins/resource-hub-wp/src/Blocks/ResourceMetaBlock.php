<?php
/**
 * The `resource-hub/resource-meta` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use WP_Block;

/**
 * The single resource page's meta line (the type with its mark, the date, the topics), for the CMS theme's single-resource template.
 *
 * The front end's `ResourceArticle` writes the line in the article's header, under the `h1`; core's blocks
 * cannot write it (the type's accent dot outside the type's link, the date as the site formats it, the
 * topics as the row's labels), so this block does, with `ResourceCardMarkup::meta()`, whose docblock has
 * every markup rule. The type's name links to the front end's listing of the type and each topic's to
 * its listing, as on the site, on the CMS's origin.
 *
 * - **Which post.** The `postId` and `postType` context, which `render_block()` sets from the global post
 *   in a single template and the editor's preview sends as the post being edited
 *   (`ContextResource::readable()`): a published resource, or one the current user may read, so a
 *   logged-in preview of a draft or scheduled resource shows its line. Anything else renders nothing, and
 *   so does a resource without exactly one type, which the front end does not render at all.
 * - **No wrapper.** The output is the `<div class="rh-resource__meta">` alone, with no block wrapper
 *   attributes, so it is the front end's markup exactly.
 * - **Styles.** `block.json` lists the shared `resource-hub-tokens` handle and then the block's
 *   `style-index.css`, the package's `card-labels.css` inlined by the build: the mark and the topic labels,
 *   which the line borrows from the row, as the front end's `ResourceArticle` imports `card-labels.css`
 *   alone for it. The line's own layout and its links' underlines are the article's, in `resource.css`,
 *   which the template that renders the article loads.
 *
 * Registered from `build/resource-meta/`, so without a build the block is not registered.
 */
final class ResourceMetaBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/resource-meta';

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/resource-meta/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/resource-meta';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the context's resource's meta line, or nothing.
	 *
	 * @param array<string, mixed> $attributes The block's attributes; it has none.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$post = ContextResource::readable( $block );
		$type = null === $post ? null : ResourceCardMarkup::type( $post );

		return null === $post || null === $type ? '' : ResourceCardMarkup::meta( $post, $type );
	}
}
