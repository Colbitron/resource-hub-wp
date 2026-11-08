<?php
/**
 * The resource a block's context names: a published one, or one the current user may read.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use ResourceHub\ContentModel\PostType;
use WP_Block;
use WP_Post;

/**
 * Reads `postId` and `postType` from a block's context and returns the resource it names, by one of two rules.
 *
 * `core/post-template` sets both keys for each post it lists; `render_block()` sets them from the global
 * post everywhere else (a single template, a post's own content), and the editor's preview endpoint from
 * the `post_id` it is sent. A `postType` in the context that is not `resource` settles it before any
 * lookup; without one, the post's own type decides.
 *
 * - **`from()`: published only**, for the blocks that list resources: the card and the related section.
 *   They show what the front end shows, and the front end lists only published resources, so a draft, a
 *   scheduled, private or trashed resource, and any other post type, gets nothing from either. The card
 *   lives in query loops, which ask for published posts anyway. The related section must not pass anything
 *   else into `RelatedItems`, whose cache entry is the public related route's too (`RelatedBlock`).
 * - **`readable()`: published, or readable by the current user**, for the article's own blocks, the meta
 *   line, the summary and the source line. The theme's pages are for editors and logged-in previews
 *   (ADR 0031), and a preview of a draft or scheduled resource is the page it will become, so those blocks
 *   render it for a user core lets read it (`read_post`: its author, or a user who may edit others' posts
 *   or read private ones), and nothing for anyone else, a visitor or a subscriber among them. What they
 *   show is the resource's own fields, which that user can already read in the editor; nothing is cached.
 *
 * A password-protected resource is a published one under both: the REST API lists it, the front end
 * renders it and the related route lists it (`RelatedItems`), so the blocks render it too. None shows
 * anything the password guards: the summary and source are public meta, and none of the blocks shows
 * the content; the card's title leaves out core's "Protected: " prefix, as the REST API's does
 * (`ResourceCardMarkup::title()`).
 */
final class ContextResource {
	/**
	 * The published resource the block's context names, or null.
	 *
	 * @param WP_Block $block The block being rendered.
	 */
	public static function from( WP_Block $block ): ?WP_Post {
		$post = self::resource( $block );

		return null !== $post && 'publish' === $post->post_status ? $post : null;
	}

	/**
	 * The resource the block's context names when it is published or the current user may read it, or null.
	 *
	 * @param WP_Block $block The block being rendered.
	 */
	public static function readable( WP_Block $block ): ?WP_Post {
		$post = self::resource( $block );

		if ( null === $post ) {
			return null;
		}

		return 'publish' === $post->post_status || current_user_can( 'read_post', $post->ID ) ? $post : null;
	}

	/**
	 * The resource the block's context names, whatever its status, or null.
	 *
	 * @param WP_Block $block The block being rendered.
	 */
	private static function resource( WP_Block $block ): ?WP_Post {
		$id   = $block->context['postId'] ?? 0;
		$type = $block->context['postType'] ?? PostType::NAME;

		if ( PostType::NAME !== $type || ! is_numeric( $id ) || (int) $id <= 0 ) {
			return null;
		}

		$post = get_post( (int) $id );

		return $post instanceof WP_Post && PostType::NAME === $post->post_type ? $post : null;
	}
}
