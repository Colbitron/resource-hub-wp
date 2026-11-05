<?php
/**
 * Resource permalinks carry the type: `/resources/{type}/{slug}/` (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use WP_Post;
use WP_Term;

/**
 * Fills the `%resource_type%` rewrite tag in the post type's permalink structure.
 *
 * The post type's rewrite slug is `resources/%resource_type%`, using the tag core registers for
 * the taxonomy, so the structure is `resources/%resource_type%/%resource%`. Core fills
 * `%resource%`; this fills the type, and `get_permalink()` stays absolute on the CMS's domain.
 *
 * A resource with no type yet, which only a draft can be through the editor, gets core's plain
 * link, `?post_type=resource&p={id}`, instead of a guessed segment. That link always resolves,
 * so a preview works, and nothing invents a type path the front end does not have. Drafts have
 * plain links anyway (core gives pretty links only to published posts), so in practice this
 * shows in the editor's URL panel, which offers the slug for editing once a type is saved.
 */
final class Permalink {
	/**
	 * The rewrite tag core registers for `resource_type`.
	 */
	public const TYPE_TAG = '%' . Taxonomies::TYPE . '%';

	/**
	 * Hooks the filter.
	 */
	public function register(): void {
		add_filter( 'post_type_link', array( $this, 'fill_type' ), 10, 2 );
	}

	/**
	 * Replaces the type tag with the resource's type slug, or falls back to the plain link.
	 * Hooked to `post_type_link`.
	 *
	 * If a resource has more than one type, which the REST check prevents but a PHP caller could
	 * still store, the first one `get_the_terms()` returns is used.
	 *
	 * @param string  $post_link The permalink core built.
	 * @param WP_Post $post      The post.
	 */
	public function fill_type( $post_link, $post ): string {
		$post_link = (string) $post_link;

		if ( ! $post instanceof WP_Post || PostType::NAME !== $post->post_type || ! str_contains( $post_link, self::TYPE_TAG ) ) {
			return $post_link;
		}

		$terms = get_the_terms( $post, Taxonomies::TYPE );

		if ( is_array( $terms ) && $terms[0] instanceof WP_Term ) {
			return str_replace( self::TYPE_TAG, $terms[0]->slug, $post_link );
		}

		return home_url(
			add_query_arg(
				array(
					'post_type' => PostType::NAME,
					'p'         => $post->ID,
				),
				''
			)
		);
	}
}
