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
	 * Flat, open taxonomy: what a resource is about. Anyone who can write a resource can add a topic.
	 */
	public const TOPIC = 'resource_topic';

	/**
	 * Hierarchical, editor-managed taxonomy: what kind of resource it is (article, ebook, ...).
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
	 *
	 * `hierarchical` is a capability boundary here, not only a UI choice (ADR 0009). Core's terms
	 * controller lets a user create a term in a flat taxonomy when they can `assign_terms`, but in
	 * a hierarchical one only when they can `edit_terms`. So a flat taxonomy is open to anyone who
	 * can tag a post, and a hierarchical one with its own `edit_terms` is closed.
	 */
	public function register(): void {
		register_taxonomy(
			self::TOPIC,
			PostType::NAME,
			array(
				'labels'            => array(
					'name'                       => _x( 'Topics', 'taxonomy general name', 'resource-hub' ),
					'singular_name'              => _x( 'Topic', 'taxonomy singular name', 'resource-hub' ),
					'search_items'               => __( 'Search Topics', 'resource-hub' ),
					'popular_items'              => __( 'Popular Topics', 'resource-hub' ),
					'all_items'                  => __( 'All Topics', 'resource-hub' ),
					'edit_item'                  => __( 'Edit Topic', 'resource-hub' ),
					'view_item'                  => __( 'View Topic', 'resource-hub' ),
					'update_item'                => __( 'Update Topic', 'resource-hub' ),
					'add_new_item'               => __( 'Add New Topic', 'resource-hub' ),
					'new_item_name'              => __( 'New Topic Name', 'resource-hub' ),
					'separate_items_with_commas' => __( 'Separate topics with commas', 'resource-hub' ),
					'add_or_remove_items'        => __( 'Add or remove topics', 'resource-hub' ),
					'choose_from_most_used'      => __( 'Choose from the most used topics', 'resource-hub' ),
					'not_found'                  => __( 'No topics found.', 'resource-hub' ),
					'no_terms'                   => __( 'No topics', 'resource-hub' ),
					'back_to_items'              => __( '&larr; Go to Topics', 'resource-hub' ),
					'items_list_navigation'      => __( 'Topics list navigation', 'resource-hub' ),
					'items_list'                 => __( 'Topics list', 'resource-hub' ),
					'item_link'                  => _x( 'Topic Link', 'navigation link block title', 'resource-hub' ),
					'item_link_description'      => _x( 'A link to a topic.', 'navigation link block description', 'resource-hub' ),
					'menu_name'                  => __( 'Topics', 'resource-hub' ),
				),
				'description'       => __( 'What a resource is about.', 'resource-hub' ),
				// Flat and open, like tags: anyone who can write a resource (`assign_terms`, which core
				// defaults to `edit_posts`) can add a topic while writing, over REST or in the editor.
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
				'labels'             => array(
					'name'                  => _x( 'Types', 'taxonomy general name', 'resource-hub' ),
					'singular_name'         => _x( 'Type', 'taxonomy singular name', 'resource-hub' ),
					'search_items'          => __( 'Search Types', 'resource-hub' ),
					'all_items'             => __( 'All Types', 'resource-hub' ),
					'parent_item'           => __( 'Parent Type', 'resource-hub' ),
					'parent_item_colon'     => __( 'Parent Type:', 'resource-hub' ),
					'edit_item'             => __( 'Edit Type', 'resource-hub' ),
					'view_item'             => __( 'View Type', 'resource-hub' ),
					'update_item'           => __( 'Update Type', 'resource-hub' ),
					'add_new_item'          => __( 'Add New Type', 'resource-hub' ),
					'new_item_name'         => __( 'New Type Name', 'resource-hub' ),
					'not_found'             => __( 'No types found.', 'resource-hub' ),
					'no_terms'              => __( 'No types', 'resource-hub' ),
					'back_to_items'         => __( '&larr; Go to Types', 'resource-hub' ),
					'filter_by_item'        => __( 'Filter by type', 'resource-hub' ),
					'items_list_navigation' => __( 'Types list navigation', 'resource-hub' ),
					'items_list'            => __( 'Types list', 'resource-hub' ),
					'item_link'             => _x( 'Type Link', 'navigation link block title', 'resource-hub' ),
					'item_link_description' => _x( 'A link to a type.', 'navigation link block description', 'resource-hub' ),
					'menu_name'             => __( 'Types', 'resource-hub' ),
				),
				'description'        => __( 'What kind of resource it is: article, ebook, webinar, podcast, or case study.', 'resource-hub' ),
				// A fixed vocabulary (ADR 0007). Hierarchical so creating a term needs `edit_terms`, which
				// only editors and administrators hold here. A resource has exactly one type (OneType), the
				// editor shows radio buttons, and `topic` and `page` are reserved (ReservedTypeSlugs; ADR 0024).
				'hierarchical'       => true,
				'public'             => true,
				'show_admin_column'  => true,
				// Quick Edit and Bulk Edit save outside REST, where OneType guards the status and drops type
				// terms from a Bulk Edit request, so the type is changed in the editor only.
				'show_in_quick_edit' => false,
				'show_in_rest'       => true,
				'rest_base'          => self::TYPE,
				'rewrite'            => array( 'slug' => 'resource-type' ),
				// Editors and administrators (`manage_categories`) manage types; anyone who can write a
				// resource can pick one.
				'capabilities'       => array(
					'manage_terms' => 'manage_categories',
					'edit_terms'   => 'manage_categories',
					'delete_terms' => 'manage_categories',
					'assign_terms' => 'edit_posts',
				),
			)
		);

		register_taxonomy(
			self::FLAG,
			PostType::NAME,
			array(
				'labels'            => array(
					'name'                  => _x( 'Flags', 'taxonomy general name', 'resource-hub' ),
					'singular_name'         => _x( 'Flag', 'taxonomy singular name', 'resource-hub' ),
					'search_items'          => __( 'Search Flags', 'resource-hub' ),
					'all_items'             => __( 'All Flags', 'resource-hub' ),
					'parent_item'           => __( 'Parent Flag', 'resource-hub' ),
					'parent_item_colon'     => __( 'Parent Flag:', 'resource-hub' ),
					'edit_item'             => __( 'Edit Flag', 'resource-hub' ),
					'view_item'             => __( 'View Flag', 'resource-hub' ),
					'update_item'           => __( 'Update Flag', 'resource-hub' ),
					'add_new_item'          => __( 'Add New Flag', 'resource-hub' ),
					'new_item_name'         => __( 'New Flag Name', 'resource-hub' ),
					'not_found'             => __( 'No flags found.', 'resource-hub' ),
					'no_terms'              => __( 'No flags', 'resource-hub' ),
					'back_to_items'         => __( '&larr; Go to Flags', 'resource-hub' ),
					'filter_by_item'        => __( 'Filter by flag', 'resource-hub' ),
					'items_list_navigation' => __( 'Flags list navigation', 'resource-hub' ),
					'items_list'            => __( 'Flags list', 'resource-hub' ),
					'item_link'             => _x( 'Flag Link', 'navigation link block title', 'resource-hub' ),
					'item_link_description' => _x( 'A link to a flag.', 'navigation link block description', 'resource-hub' ),
					'menu_name'             => __( 'Flags', 'resource-hub' ),
				),
				'description'       => __( 'Editorial flags the plugin defines in code, such as featured.', 'resource-hub' ),
				// Hierarchical so creating a term needs `edit_terms`, which nobody holds (below), and so the
				// editor shows a checkbox list rather than a free-text tag box.
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
	 * tests site reinstall WordPress without firing activation hooks. The lookup is a term query:
	 * with a persistent object cache it is answered from memory, and without one it is one
	 * database query per request.
	 *
	 * If another request creates the term between the lookup and the insert, `wp_insert_term()`
	 * reports `term_exists` with the existing term's ID, and that ID is returned.
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
			return 'term_exists' === $created->get_error_code() ? (int) $created->get_error_data( 'term_exists' ) : 0;
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
