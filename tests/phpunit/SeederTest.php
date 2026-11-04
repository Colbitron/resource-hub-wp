<?php
/**
 * The seeder creates the catalogue once and leaves it alone afterwards.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Seed\Seeder;
use WP_UnitTestCase;

/**
 * Seeder tests. The seeder is called directly; the WP-CLI command is a thin wrapper around it.
 */
final class SeederTest extends WP_UnitTestCase {
	/**
	 * Meta keys are unregistered between tests; the seeder relies on the sanitizers being attached.
	 */
	public function set_up(): void {
		parent::set_up();
		( new Meta() )->register();
	}

	/**
	 * Two runs leave the same number of resources and terms as one.
	 */
	public function test_seeding_twice_is_idempotent(): void {
		$seeder = new Seeder();

		$first = $seeder->seed( 12 );
		$this->assertSame( 12, $first['created'] );
		$this->assertSame( 0, $first['skipped'] );
		$this->assertSame( array(), $first['errors'] );

		$second = $seeder->seed( 12 );
		$this->assertSame( 0, $second['created'] );
		$this->assertSame( 12, $second['skipped'] );

		$this->assertSame( 12, (int) wp_count_posts( PostType::NAME )->publish );
		$this->assertCount(
			5,
			get_terms(
				array(
					'taxonomy'   => Taxonomies::TYPE,
					'hide_empty' => false,
				)
			)
		);
		$this->assertCount(
			5,
			get_terms(
				array(
					'taxonomy'   => Taxonomies::TOPIC,
					'hide_empty' => false,
				)
			)
		);
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
	 * Every seeded resource has one type, at least one topic, a summary, and a sanitized source URL; some are featured.
	 */
	public function test_seeded_resources_have_terms_and_meta(): void {
		( new Seeder() )->seed( 12 );

		$query = new \WP_Query(
			array(
				'post_type'      => PostType::NAME,
				'post_status'    => 'publish',
				'posts_per_page' => 20,
				'no_found_rows'  => true,
			)
		);

		$this->assertCount( 12, $query->posts );

		$featured = 0;
		foreach ( $query->posts as $post ) {
			$this->assertCount( 1, wp_get_object_terms( $post->ID, Taxonomies::TYPE ), "{$post->post_name} should have one type." );
			$this->assertNotEmpty( wp_get_object_terms( $post->ID, Taxonomies::TOPIC ), "{$post->post_name} should have a topic." );
			$this->assertNotSame( '', get_post_meta( $post->ID, Meta::SUMMARY, true ), "{$post->post_name} should have a summary." );

			$source_url = get_post_meta( $post->ID, Meta::SOURCE_URL, true );
			$this->assertTrue( '' === $source_url || str_starts_with( $source_url, 'https://example.' ), "{$post->post_name} has an unexpected source URL." );

			if ( has_term( Taxonomies::FEATURED, Taxonomies::FLAG, $post ) ) {
				++$featured;
			}
		}

		$this->assertGreaterThan( 0, $featured );
		$this->assertLessThan( 12, $featured );
	}

	/**
	 * The seeder creates exactly the five types from the brief, with "Case study" spelled as a label.
	 */
	public function test_seeds_the_five_types(): void {
		( new Seeder() )->seed( 1 );

		$types = get_terms(
			array(
				'taxonomy'   => Taxonomies::TYPE,
				'hide_empty' => false,
				'orderby'    => 'slug',
			)
		);

		$this->assertSame( array( 'article', 'case-study', 'ebook', 'podcast', 'webinar' ), wp_list_pluck( $types, 'slug' ) );
		$this->assertSame( 'Case study', get_term_by( 'slug', 'case-study', Taxonomies::TYPE )->name );
	}

	/**
	 * A count above the catalogue size is capped rather than failing.
	 */
	public function test_count_is_capped_at_the_catalogue(): void {
		$result = ( new Seeder() )->seed( 999 );

		$this->assertSame( $result['total'], $result['created'] );
		$this->assertSame( $result['total'], (int) wp_count_posts( PostType::NAME )->publish );
		$this->assertGreaterThanOrEqual( Seeder::DEFAULT_COUNT, $result['total'] );
	}

	/**
	 * With no current user and no administrator, seeded resources go to the first user who can write posts.
	 */
	public function test_author_falls_back_to_a_user_who_can_write(): void {
		wp_set_current_user( 0 );

		foreach ( get_users( array( 'role' => 'administrator' ) ) as $admin ) {
			$admin->set_role( 'subscriber' );
		}

		$editor_id = self::factory()->user->create( array( 'role' => 'editor' ) );

		( new Seeder() )->seed( 1 );

		$query = new \WP_Query(
			array(
				'post_type'      => PostType::NAME,
				'posts_per_page' => 5,
				'no_found_rows'  => true,
			)
		);

		$this->assertCount( 1, $query->posts );
		$this->assertSame( $editor_id, (int) $query->posts[0]->post_author );
	}

	/**
	 * A term assignment that fails is reported in `errors` rather than ignored.
	 */
	public function test_failed_term_assignment_is_reported(): void {
		unregister_taxonomy( Taxonomies::TOPIC );

		try {
			$result = ( new Seeder() )->seed( 1 );
		} finally {
			( new Taxonomies() )->register();
		}

		$this->assertSame( 1, $result['created'] );
		$this->assertCount( 1, $result['errors'] );
		$this->assertStringContainsString( Taxonomies::TOPIC, $result['errors'][0] );
	}
}
