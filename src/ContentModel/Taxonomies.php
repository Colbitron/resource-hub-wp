<?php
/**
 * The three taxonomies attached to `resource`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\ContentModel;

use WP_Term;

/**
 * Registers `resource_topic`, `resource_type`, and the code-managed `resource_flag` (ADR 0009).
 */
final class Taxonomies {
	/**
	 * Flat taxonomy: what a resource is about.
	 */
	public const TOPIC = 'resource_topic';

	/**
	 * Flat taxonomy: what kind of resource it is (article, ebook, ...).
	 */
	public const TYPE = 'resource_type';

	/**
	 * Hierarchical taxonomy whose terms are created by this plugin, never by editors.
	 */
	public const FLAG = 'resource_flag';

	/**
	 * Slug of the one flag the plugin ships: a featured resource.
	 */
	public const FEATURED = 'featured';

	/**
	 * Registers the taxonomies and makes sure the `featured` flag exists. Hooked to `init`.
	 */
	public function register(): void {
		register_taxonomy(
			self::TOPIC,
			PostType::NAME,
			array(
				'labels'            => array(
					'name'          => _x( 'Topics', 'taxonomy general name', 'resource-hub' ),
					'singular_name' => _x( 'Topic', 'taxonomy singular name', 'resource-hub' ),
					'search_items'  => __( 'Search Topics', 'resource-hub' ),
					'all_items'     => __( 'All Topics', 'resource-hub' ),
					'edit_item'     => __( 'Edit Topic', 'resource-hub' ),
					'update_item'   => __( 'Update Topic', 'resource-hub' ),
					'add_new_item'  => __( 'Add New Topic', 'resource-hub' ),
					'new_item_name' => __( 'New Topic Name', 'resource-hub' ),
					'menu_name'     => __( 'Topics', 'resource-hub' ),
				),
				'description'       => __( 'What a resource is about.', 'resource-hub' ),
				'hierarchical'      => false,
				'public'            => true,
				'show_admin_column' => true,
				'show_in_rest'      => true,
				'rest_base'         => self::TOPIC,
				'rewrite'           => array( 'slug' => 'resource-topic' ),
			)
		);

		register_taxonomy(
			self::TYPE,
			PostType::NAME,
			array(
				'labels'            => array(
					'name'          => _x( 'Types', 'taxonomy general name', 'resource-hub' ),
					'singular_name' => _x( 'Type', 'taxonomy singular name', 'resource-hub' ),
					'search_items'  => __( 'Search Types', 'resource-hub' ),
					'all_items'     => __( 'All Types', 'resource-hub' ),
					'edit_item'     => __( 'Edit Type', 'resource-hub' ),
					'update_item'   => __( 'Update Type', 'resource-hub' ),
					'add_new_item'  => __( 'Add New Type', 'resource-hub' ),
					'new_item_name' => __( 'New Type Name', 'resource-hub' ),
					'menu_name'     => __( 'Types', 'resource-hub' ),
				),
				'description'       => __( 'What kind of resource it is: article, ebook, webinar, podcast, or case study.', 'resource-hub' ),
				'hierarchical'      => false,
				'public'            => true,
				'show_admin_column' => true,
				'show_in_rest'      => true,
				'rest_base'         => self::TYPE,
				'rewrite'           => array( 'slug' => 'resource-type' ),
			)
		);

		register_taxonomy(
			self::FLAG,
			PostType::NAME,
			array(
				'labels'            => array(
					'name'          => _x( 'Flags', 'taxonomy general name', 'resource-hub' ),
					'singular_name' => _x( 'Flag', 'taxonomy singular name', 'resource-hub' ),
					'all_items'     => __( 'All Flags', 'resource-hub' ),
					'menu_name'     => __( 'Flags', 'resource-hub' ),
				),
				'description'       => __( 'Editorial flags the plugin defines in code, such as featured.', 'resource-hub' ),
				// Hierarchical so the editor renders a checkbox list rather than a free-text tag box.
				'hierarchical'      => true,
				'public'            => false,
				'show_ui'           => true,
				'show_in_menu'      => false,
				'show_admin_column' => true,
				'show_in_rest'      => true,
				'rest_base'         => self::FLAG,
				'rewrite'           => false,
				// Editors assign flags; only this plugin creates, edits, or deletes them.
				'capabilities'      => array(
					'manage_terms' => 'do_not_allow',
					'edit_terms'   => 'do_not_allow',
					'delete_terms' => 'do_not_allow',
					'assign_terms' => 'edit_posts',
				),
			)
		);

		$this->ensure_featured_flag();
	}

	/**
	 * Creates the `featured` flag if it is missing and returns its term ID.
	 *
	 * Runs on every `init` rather than only on activation because the PHPUnit bootstrap and wp-env's
	 * tests site reinstall WordPress without firing activation hooks. The lookup is a cached term
	 * query, so the steady-state cost is one object-cache read.
	 *
	 * @return int Term ID, or 0 if the term could not be created.
	 */
	public function ensure_featured_flag(): int {
		$existing = get_term_by( 'slug', self::FEATURED, self::FLAG );

		if ( $existing instanceof WP_Term ) {
			return $existing->term_id;
		}

		$created = wp_insert_term(
			__( 'Featured', 'resource-hub' ),
			self::FLAG,
			array(
				'slug'        => self::FEATURED,
				'description' => __( 'Shown first in listings and eligible for the featured section of the front end.', 'resource-hub' ),
			)
		);

		if ( is_wp_error( $created ) ) {
			return 0;
		}

		return (int) $created['term_id'];
	}

	/**
	 * Term ID of the `featured` flag, or 0 if it does not exist yet.
	 */
	public static function featured_flag_id(): int {
		$term = get_term_by( 'slug', self::FEATURED, self::FLAG );

		return $term instanceof WP_Term ? $term->term_id : 0;
	}
}
