<?php
/**
 * The `resource` post type.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

/**
 * Registers the one post type every kind of resource shares (ADR 0007).
 */
final class PostType {
	/**
	 * Post type name.
	 */
	public const NAME = 'resource';

	/**
	 * REST base, so the collection is `/wp/v2/resources`.
	 */
	public const REST_BASE = 'resources';

	/**
	 * Registers the post type. Hooked to `init`.
	 */
	public function register(): void {
		register_post_type(
			self::NAME,
			array(
				'labels'          => array(
					'name'                  => _x( 'Resources', 'post type general name', 'resource-hub' ),
					'singular_name'         => _x( 'Resource', 'post type singular name', 'resource-hub' ),
					'menu_name'             => _x( 'Resources', 'admin menu', 'resource-hub' ),
					'add_new_item'          => __( 'Add New Resource', 'resource-hub' ),
					'edit_item'             => __( 'Edit Resource', 'resource-hub' ),
					'new_item'              => __( 'New Resource', 'resource-hub' ),
					'view_item'             => __( 'View Resource', 'resource-hub' ),
					'view_items'            => __( 'View Resources', 'resource-hub' ),
					'search_items'          => __( 'Search Resources', 'resource-hub' ),
					'not_found'             => __( 'No resources found.', 'resource-hub' ),
					'not_found_in_trash'    => __( 'No resources found in Trash.', 'resource-hub' ),
					'all_items'             => __( 'All Resources', 'resource-hub' ),
					'archives'              => __( 'Resource Archives', 'resource-hub' ),
					'featured_image'        => __( 'Resource image', 'resource-hub' ),
					'set_featured_image'    => __( 'Set resource image', 'resource-hub' ),
					'remove_featured_image' => __( 'Remove resource image', 'resource-hub' ),
					'use_featured_image'    => __( 'Use as resource image', 'resource-hub' ),
					'item_published'        => __( 'Resource published.', 'resource-hub' ),
					'item_updated'          => __( 'Resource updated.', 'resource-hub' ),
				),
				'description'     => __( 'A filterable library of articles, ebooks, webinars, podcasts, and case studies.', 'resource-hub' ),
				// Public with a rewrite slug so resources have WordPress URLs for the server-rendered block; the headless front end is the
				// primary reader. Pretty URLs under /resources/ work once rewrite rules are regenerated, which activation triggers (Plugin::activate()).
				// Single resources are /resources/{type}/{slug}/, mirroring the front end (ADR 0024): the slug carries the taxonomy's rewrite
				// tag, which Permalink fills. The archive slug is set apart, because `true` would reuse the rewrite slug, tag and all.
				'public'          => true,
				'has_archive'     => 'resources',
				'rewrite'         => array(
					'slug'       => 'resources/' . Permalink::TYPE_TAG,
					'with_front' => false,
				),
				'show_in_rest'    => true,
				'rest_base'       => self::REST_BASE,
				'menu_position'   => 20,
				'menu_icon'       => 'dashicons-portfolio',
				// `custom-fields` is what makes the block editor load `meta` into the post entity for the sidebar panel.
				'supports'        => array( 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields' ),
				'capability_type' => 'post',
				'map_meta_cap'    => true,
			)
		);
	}
}
