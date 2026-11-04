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
		$this->assertSame( 'resources', $post_type->rewrite['slug'] );

		foreach ( array( 'title', 'editor', 'excerpt', 'thumbnail', 'revisions', 'custom-fields' ) as $feature ) {
			$this->assertTrue( post_type_supports( PostType::NAME, $feature ), "Missing support for {$feature}." );
		}
	}

	/**
	 * Topic and type are flat; flag is hierarchical. All three are attached to `resource` and in REST under their own names.
	 */
	public function test_taxonomies_are_registered_for_rest(): void {
		$expected = array(
			Taxonomies::TOPIC => false,
			Taxonomies::TYPE  => false,
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
