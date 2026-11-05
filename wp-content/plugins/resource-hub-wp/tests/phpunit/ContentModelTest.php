<?php
/**
 * The post type and taxonomies register with the REST flags the front end relies on.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_REST_Request;
use WP_UnitTestCase;

/**
 * Registration tests for `resource`, `resource_topic`, `resource_type`, and `resource_flag`.
 */
final class ContentModelTest extends WP_UnitTestCase {
	/**
	 * The post type is public, REST-exposed under `resources`, and supports what the editor needs.
	 */
	public function test_post_type_is_registered_for_rest(): void {
		$post_type = get_post_type_object( PostType::NAME );

		$this->assertNotNull( $post_type );
		$this->assertTrue( $post_type->public );
		$this->assertTrue( $post_type->show_in_rest );
		$this->assertSame( 'resources', $post_type->rest_base );
		$this->assertSame( 'resources/%resource_type%', $post_type->rewrite['slug'] );
		$this->assertSame( 'resources', $post_type->has_archive );

		foreach ( array( 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields' ) as $feature ) {
			$this->assertTrue( post_type_supports( PostType::NAME, $feature ), "Missing support for {$feature}." );
		}
	}

	/**
	 * Topic is flat; type and flag are hierarchical. All three are attached to `resource` and in REST under their own names.
	 */
	public function test_taxonomies_are_registered_for_rest(): void {
		$expected = array(
			Taxonomies::TOPIC => false,
			Taxonomies::TYPE  => true,
			Taxonomies::FLAG  => true,
		);

		foreach ( $expected as $name => $hierarchical ) {
			$taxonomy = get_taxonomy( $name );

			$this->assertNotFalse( $taxonomy, "{$name} is not registered." );
			$this->assertSame( $hierarchical, $taxonomy->hierarchical, "{$name} hierarchy is wrong." );
			$this->assertTrue( $taxonomy->show_in_rest, "{$name} is not in REST." );
			$this->assertSame( $name, $taxonomy->rest_base, "{$name} REST base is wrong." );
			$this->assertContains( PostType::NAME, $taxonomy->object_type, "{$name} is not attached to resource." );
		}
	}

	/**
	 * Editors can assign flags but nobody can manage them through WordPress.
	 */
	public function test_flag_terms_are_assignable_but_not_manageable(): void {
		$caps = get_taxonomy( Taxonomies::FLAG )->cap;

		$this->assertSame( 'do_not_allow', $caps->manage_terms );
		$this->assertSame( 'do_not_allow', $caps->edit_terms );
		$this->assertSame( 'do_not_allow', $caps->delete_terms );
		$this->assertSame( 'edit_posts', $caps->assign_terms );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertTrue( current_user_can( $caps->assign_terms ) );
		$this->assertFalse( current_user_can( $caps->edit_terms ) );
	}

	/**
	 * Editors and administrators manage types; anyone who can write a resource can assign one.
	 */
	public function test_type_terms_are_managed_by_editors(): void {
		$caps = get_taxonomy( Taxonomies::TYPE )->cap;

		$this->assertSame( 'manage_categories', $caps->manage_terms );
		$this->assertSame( 'manage_categories', $caps->edit_terms );
		$this->assertSame( 'manage_categories', $caps->delete_terms );
		$this->assertSame( 'edit_posts', $caps->assign_terms );
	}

	/**
	 * Quick Edit and Bulk Edit on the Resources list do not offer the type: they save outside REST,
	 * where the one-type rule is checked, and Bulk Edit adds terms rather than replacing them.
	 */
	public function test_type_is_not_in_quick_edit(): void {
		$this->assertFalse( get_taxonomy( Taxonomies::TYPE )->show_in_quick_edit );
	}

	/**
	 * Every label the editor or admin shows names the taxonomy's own terms, so nothing falls back to
	 * core's "Category" or "Tag" wording.
	 */
	public function test_taxonomies_have_their_own_labels(): void {
		foreach ( array(
			Taxonomies::TOPIC => 'Topic',
			Taxonomies::TYPE  => 'Type',
			Taxonomies::FLAG  => 'Flag',
		) as $name => $singular ) {
			$labels = get_taxonomy( $name )->labels;

			$this->assertSame( "Add New {$singular}", $labels->add_new_item );
			$this->assertSame( "New {$singular} Name", $labels->new_item_name );
			$this->assertSame( "Search {$singular}s", $labels->search_items );

			foreach ( get_object_vars( $labels ) as $key => $label ) {
				if ( is_string( $label ) ) {
					$this->assertDoesNotMatchRegularExpression( '/categor|\btags?\b/i', $label, "{$name} label {$key} uses core's default wording." );
				}
			}
		}

		$this->assertSame( 'Parent Type', get_taxonomy( Taxonomies::TYPE )->labels->parent_item );
		$this->assertSame( 'Parent Flag', get_taxonomy( Taxonomies::FLAG )->labels->parent_item );
	}

	/**
	 * Creating a term over REST, as real users. Hierarchical taxonomies need `edit_terms`; the flat
	 * topic taxonomy needs only `assign_terms`, so authors can add topics.
	 *
	 * @dataProvider term_creation_cases
	 *
	 * @param string $taxonomy Taxonomy REST base (the same as its name here).
	 * @param string $role     Role of the user making the request.
	 * @param int    $status   Expected HTTP status.
	 */
	public function test_term_creation_over_rest( string $taxonomy, string $role, int $status ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => $role ) ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/' . $taxonomy );
		$request->set_body_params( array( 'name' => "Made by {$role}" ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( $status, $response->get_status() );
		$this->assertSame( 201 === $status, get_term_by( 'name', "Made by {$role}", $taxonomy ) instanceof \WP_Term );
	}

	/**
	 * Cases for test_term_creation_over_rest().
	 *
	 * @return array<string, array{0: string, 1: string, 2: int}>
	 */
	public function term_creation_cases(): array {
		return array(
			'flag, editor'        => array( Taxonomies::FLAG, 'editor', 403 ),
			'flag, administrator' => array( Taxonomies::FLAG, 'administrator', 403 ),
			'type, contributor'   => array( Taxonomies::TYPE, 'contributor', 403 ),
			'type, author'        => array( Taxonomies::TYPE, 'author', 403 ),
			'type, editor'        => array( Taxonomies::TYPE, 'editor', 201 ),
			'type, administrator' => array( Taxonomies::TYPE, 'administrator', 201 ),
			'topic, author'       => array( Taxonomies::TOPIC, 'author', 201 ),
			'topic, contributor'  => array( Taxonomies::TOPIC, 'contributor', 201 ),
			'topic, subscriber'   => array( Taxonomies::TOPIC, 'subscriber', 403 ),
		);
	}

	/**
	 * An author can flag their own resource as featured over REST.
	 */
	public function test_author_can_feature_own_resource(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$post_id   = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_author' => $author_id,
			)
		);
		// A published resource keeps exactly one type through every REST save (OneType).
		wp_set_object_terms( $post_id, self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ), Taxonomies::TYPE );

		wp_set_current_user( $author_id );

		$request = new WP_REST_Request( 'POST', '/wp/v2/resources/' . $post_id );
		$request->set_body_params( array( Taxonomies::FLAG => array( Taxonomies::featured_flag_id() ) ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( has_term( Taxonomies::FEATURED, Taxonomies::FLAG, $post_id ) );
	}

	/**
	 * A contributor cannot edit someone else's resource over REST.
	 */
	public function test_contributor_cannot_edit_others_resource(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
				'post_author' => self::factory()->user->create( array( 'role' => 'author' ) ),
				'post_title'  => 'Original',
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'contributor' ) ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/resources/' . $post_id );
		$request->set_body_params( array( 'title' => 'Changed' ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'Original', get_post( $post_id )->post_title );
	}

	/**
	 * The plugin creates the `featured` flag on `init`, and a second `init` does not duplicate it.
	 */
	public function test_featured_flag_exists_after_init(): void {
		$term = get_term_by( 'slug', Taxonomies::FEATURED, Taxonomies::FLAG );

		$this->assertInstanceOf( 'WP_Term', $term );
		$this->assertSame( $term->term_id, Taxonomies::featured_flag_id() );

		( new Taxonomies() )->ensure_featured_flag();

		$this->assertCount(
			1,
			get_terms(
				array(
					'taxonomy'   => Taxonomies::FLAG,
					'hide_empty' => false,
				)
			)
		);
	}

	/**
	 * If the lookup misses but the insert finds the term already there (another request created it in
	 * between), the existing term's ID is returned, not 0.
	 */
	public function test_ensure_featured_flag_returns_existing_id_on_race(): void {
		$existing_id = Taxonomies::featured_flag_id();
		$this->assertGreaterThan( 0, $existing_id );

		// Make only the next term query come back empty, as if the term did not exist yet.
		$miss_once = static function () use ( &$miss_once ) {
			remove_filter( 'terms_pre_query', $miss_once );
			return array();
		};
		add_filter( 'terms_pre_query', $miss_once );

		$this->assertSame( $existing_id, ( new Taxonomies() )->ensure_featured_flag() );
		$this->assertFalse( has_filter( 'terms_pre_query', $miss_once ), 'The lookup should have consumed the filter.' );
	}

	/**
	 * Filtering the collection by the featured flag returns flagged resources only.
	 */
	public function test_collection_filters_by_flag(): void {
		$featured_id = Taxonomies::featured_flag_id();
		$flagged     = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		$plain       = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );

		wp_set_object_terms( $flagged, array( $featured_id ), Taxonomies::FLAG );

		$request = new WP_REST_Request( 'GET', '/wp/v2/resources' );
		$request->set_param( Taxonomies::FLAG, $featured_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$ids = wp_list_pluck( $response->get_data(), 'id' );

		$this->assertContains( $flagged, $ids );
		$this->assertNotContains( $plain, $ids );
	}
}
