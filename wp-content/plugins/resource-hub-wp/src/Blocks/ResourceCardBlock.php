<?php
/**
 * The `resource-hub/resource-card` block: its registration and its server render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Blocks;

use WP_Block;

/**
 * One resource as the front end's listing row, for a `core/post-template` in the CMS theme's collection templates.
 *
 * The front end's listings render each resource with `ResourceCard`; core's blocks cannot write its row
 * (the type's name with its accent dot, the date, the topics list), so this block does, with the same
 * renderer as the related-resources block's rows (`ResourceCardMarkup::row()`, whose docblock has every
 * markup rule), and the CMS's logged-in previews show the site's rows. A plugin block rather than theme
 * markup, so the rows survive a theme switch and the theme stays presentation only.
 *
 * - **Which post.** The `postId` and `postType` context, which the post template sets for each post it
 *   lists (`ContextResource`). Anything but a published resource renders nothing, and so does a resource
 *   without exactly one type, which the front end gives no URL and no row (`toCard()` returns null).
 * - **The title** is the plain-text title, or "Untitled resource" when that is empty, as the front end's
 *   listing shows it (`cardTitle()`); unlike the related list, which drops such a resource, a listing
 *   lists every resource it counts.
 * - **The heading level** is the `level` attribute, 2 to 4, `ResourceCard`'s `headingLevel` (`h2` under
 *   the page's `h1`, `h3` under the "Latest" heading); a stored value outside that range is clamped and
 *   anything that is not a number is 2, the component's default.
 * - **No wrapper.** The output is the `<article class="rh-card">` alone, with no block wrapper attributes
 *   (`supports.className` and `customClassName` are off), so it is the front end's markup exactly. The
 *   list around it is the post template's: a template that wants the front end's list puts `rh-card-grid`
 *   on the post template, whose `<ul>` and `<li>` stand in for the front end's.
 * - **Styles.** `block.json` lists two shared handles, `resource-hub-tokens` and then `resource-hub-card`
 *   (`SharedCard`, the package's `card.css`), the related block's own two, so core loads them in the
 *   editor and only where a block that uses them is on the CMS's pages, and a page with both blocks loads
 *   the row's rules once.
 *
 * Registered from `build/resource-card/`, as the related block is from `build/related-resources/`, so
 * without a build the block is not registered.
 */
final class ResourceCardBlock {
	/**
	 * The block name, as in `block.json`.
	 */
	public const NAME = 'resource-hub/resource-card';

	/**
	 * The smallest, the largest and the default heading level, matching `ResourceCard`'s `headingLevel`.
	 */
	public const MIN_LEVEL     = 2;
	public const MAX_LEVEL     = 4;
	public const DEFAULT_LEVEL = 2;

	/**
	 * Hooks the registration onto `init`.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'register_block' ) );
	}

	/**
	 * Registers the block from `build/resource-card/`, when the build exists.
	 */
	public function register_block(): void {
		$dir = dirname( __DIR__, 2 ) . '/build/resource-card';

		if ( ! is_readable( $dir . '/block.json' ) ) {
			return;
		}

		register_block_type( $dir, array( 'render_callback' => array( $this, 'render' ) ) );
	}

	/**
	 * Renders the context's resource as a row, or nothing.
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 * @param string               $content    The saved content, always empty for this block.
	 * @param WP_Block             $block      The block being rendered, for its context.
	 */
	public function render( array $attributes, string $content, WP_Block $block ): string {
		$post = ContextResource::from( $block );
		$type = null === $post ? null : ResourceCardMarkup::type( $post );

		if ( null === $post || null === $type ) {
			return '';
		}

		$title = ResourceCardMarkup::title( $post ) ?? ResourceCardMarkup::UNTITLED;
		$level = self::clamp_level( $attributes['level'] ?? self::DEFAULT_LEVEL );

		return ResourceCardMarkup::row( $post, $title, $type, 'h' . $level );
	}

	/**
	 * Clamps a stored `level` to 2–4; anything that is not a number is the default.
	 *
	 * @param mixed $value The stored attribute.
	 */
	public static function clamp_level( mixed $value ): int {
		if ( ! is_numeric( $value ) ) {
			return self::DEFAULT_LEVEL;
		}

		return max( self::MIN_LEVEL, min( self::MAX_LEVEL, (int) $value ) );
	}
}
