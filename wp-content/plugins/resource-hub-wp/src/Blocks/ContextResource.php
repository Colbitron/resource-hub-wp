<?php
/**
 * The published resource a block's context names.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\ContentModel\PostType;
use WP_Block;
use WP_Post;

/**
 * Reads `postId` and `postType` from a block's context and returns the post only when it is a published resource.
 *
 * The card and the meta line show what the front end shows, and the front end shows only published
 * resources, so a draft, a scheduled, private or trashed resource, and any other post type, gets nothing
 * from either block. `core/post-template` sets both keys for each post it lists; `render_block()` sets
 * them from the global post everywhere else (a single template, a post's own content), and the editor's
 * preview endpoint from the `post_id` it is sent. A `postType` in the context that is not `resource`
 * settles it before any lookup; without one, the post's own type decides.
 */
final class ContextResource {
	/**
	 * The published resource the block's context names, or null.
	 *
	 * @param WP_Block $block The block being rendered.
	 */
	public static function from( WP_Block $block ): ?WP_Post {
		$id   = $block->context['postId'] ?? 0;
		$type = $block->context['postType'] ?? PostType::NAME;

		if ( PostType::NAME !== $type || ! is_numeric( $id ) || (int) $id <= 0 ) {
			return null;
		}

		$post = get_post( (int) $id );

		return $post instanceof WP_Post && PostType::NAME === $post->post_type && 'publish' === $post->post_status ? $post : null;
	}
}
