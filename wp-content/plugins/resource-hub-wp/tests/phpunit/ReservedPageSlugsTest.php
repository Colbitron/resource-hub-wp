<?php
/**
 * Top-level pages never take the front end's own first path segments (ADR 0051).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\ReservedPageSlugs;
use WP_UnitTestCase;

/**
 * Tests for {@see ReservedPageSlugs} through core's save path.
 */
final class ReservedPageSlugsTest extends WP_UnitTestCase {
	/**
	 * A top-level page asked for a reserved slug is saved with a suffix, as core does for `embed`.
	 *
	 * @dataProvider reserved_slugs
	 *
	 * @param string $slug The slug asked for.
	 */
	public function test_top_level_reserved_slug_gets_a_suffix( string $slug ): void {
		$id = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
				'post_name'   => $slug,
				'post_title'  => 'Collides',
			)
		);

		$this->assertSame( $slug . '-2', get_post_field( 'post_name', $id ) );
	}

	/**
	 * The reserved slugs, as the front end's routes use them.
	 *
	 * @return array<string, array{0: string}>
	 */
	public function reserved_slugs(): array {
		return array_combine( ReservedPageSlugs::SLUGS, array_map( static fn( string $slug ): array => array( $slug ), ReservedPageSlugs::SLUGS ) );
	}

	/**
	 * The same slug under a parent collides with nothing and is kept.
	 */
	public function test_nested_reserved_slug_is_kept(): void {
		$parent = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
				'post_name'   => 'about',
			)
		);
		$child  = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
				'post_name'   => 'resources',
				'post_parent' => $parent,
			)
		);

		$this->assertSame( 'resources', get_post_field( 'post_name', $child ) );
	}

	/**
	 * Posts and resources are not pages: the rule leaves them alone.
	 */
	public function test_other_post_types_are_not_affected(): void {
		$post = self::factory()->post->create(
			array(
				'post_status' => 'publish',
				'post_name'   => 'media',
			)
		);

		$this->assertSame( 'media', get_post_field( 'post_name', $post ) );
	}

	/**
	 * A percent-encoded or differently cased form of a reserved slug is reserved too.
	 */
	public function test_reserved_forms(): void {
		$this->assertTrue( ReservedPageSlugs::is_reserved( 'resources' ) );
		$this->assertTrue( ReservedPageSlugs::is_reserved( '%72esources' ) );
		$this->assertTrue( ReservedPageSlugs::is_reserved( 'API' ) );
		$this->assertTrue( ReservedPageSlugs::is_reserved( '_next' ) );
		$this->assertFalse( ReservedPageSlugs::is_reserved( 'resources-2' ) );
		$this->assertFalse( ReservedPageSlugs::is_reserved( 'about' ) );
	}

	/**
	 * An earlier filter's verdict is kept.
	 */
	public function test_an_earlier_bad_verdict_is_kept(): void {
		$this->assertTrue( ( new ReservedPageSlugs() )->is_bad_slug( true, 'about', 'page', 0 ) );
		$this->assertFalse( ( new ReservedPageSlugs() )->is_bad_slug( false, 'about', 'page', 0 ) );
	}
}
