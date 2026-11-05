<?php
/**
 * Resource permalinks are /resources/{type}/{slug}/ (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_UnitTestCase;

/**
 * The permalink's shape, what a resource with no type gets, and that the pretty URL resolves.
 */
final class PermalinkTest extends WP_UnitTestCase {
	/**
	 * Pretty permalinks with a trailing slash, as on the host. Setting the structure resets core's
	 * rewrite object, which drops the post type's permastructure and the taxonomy's rewrite tag, so
	 * both are registered again, as activation does.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();
	}

	/**
	 * Back to plain permalinks, as the other tests expect.
	 */
	public function tear_down(): void {
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * A published resource's permalink is absolute, carries its type, and ends with a slash.
	 */
	public function test_permalink_carries_the_type(): void {
		$post_id = $this->resource( 'publish', 'the-headless-handbook', 'ebook' );

		$this->assertSame( home_url( '/resources/ebook/the-headless-handbook/' ), get_permalink( $post_id ) );
	}

	/**
	 * Changing the type changes the path.
	 */
	public function test_permalink_follows_the_type(): void {
		$post_id = $this->resource( 'publish', 'the-headless-handbook', 'ebook' );
		wp_set_object_terms( $post_id, $this->type( 'case-study' ), Taxonomies::TYPE );

		$this->assertSame( home_url( '/resources/case-study/the-headless-handbook/' ), get_permalink( $post_id ) );
	}

	/**
	 * The editor's sample permalink keeps the slug placeholder and fills the type, so the URL panel
	 * offers the slug for editing.
	 */
	public function test_sample_permalink_fills_the_type(): void {
		$post_id = $this->resource( 'draft', 'a-draft', 'webinar' );

		list( $template, $slug ) = get_sample_permalink( $post_id );

		$this->assertSame( home_url( '/resources/webinar/%pagename%/' ), $template );
		$this->assertSame( 'a-draft', $slug );
	}

	/**
	 * A resource with no type gets core's plain link, never a guessed type segment, and its
	 * preview link works from that.
	 */
	public function test_resource_without_a_type_gets_the_plain_link(): void {
		$post_id = $this->resource( 'publish', 'no-type-yet', '' );
		$plain   = home_url( '?post_type=resource&p=' . $post_id );

		$this->assertSame( $plain, get_permalink( $post_id ) );
		$this->assertSame( $plain, get_sample_permalink( $post_id )[0] );

		$draft_id = $this->resource( 'draft', 'draft-no-type', '' );
		$this->assertStringContainsString( 'p=' . $draft_id, get_preview_post_link( $draft_id ) );
		$this->assertStringNotContainsString( '%resource_type%', get_preview_post_link( $draft_id ) );
	}

	/**
	 * The pretty URL resolves to the resource, for a logged-in user: anonymous visitors get a 404
	 * from every theme page (ADR 0031), which the lockdown tests cover.
	 */
	public function test_pretty_url_resolves(): void {
		$post_id = $this->resource( 'publish', 'measuring-what-readers-feel', 'podcast' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->go_to( get_permalink( $post_id ) );

		$this->assertTrue( is_singular( PostType::NAME ) );
		$this->assertSame( $post_id, get_queried_object_id() );
	}

	/**
	 * Other post types' links are untouched.
	 */
	public function test_other_post_types_are_untouched(): void {
		$post_id = self::factory()->post->create( array( 'post_name' => 'hello-there' ) );

		$this->assertSame( home_url( '/hello-there/' ), get_permalink( $post_id ) );
	}

	/**
	 * A resource with the given status, slug and type ('' for none).
	 *
	 * @param string $status Post status.
	 * @param string $slug   Post slug.
	 * @param string $type   Type slug, or ''.
	 */
	private function resource( string $status, string $slug, string $type ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => $status,
				'post_name'   => $slug,
				'post_title'  => $slug,
			)
		);

		if ( '' !== $type ) {
			wp_set_object_terms( $post_id, $this->type( $type ), Taxonomies::TYPE );
		}

		return $post_id;
	}

	/**
	 * The ID of the type with this slug, created if missing.
	 *
	 * @param string $slug Type slug.
	 */
	private function type( string $slug ): int {
		$term = get_term_by( 'slug', $slug, Taxonomies::TYPE );

		if ( $term ) {
			return $term->term_id;
		}

		return self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'slug'     => $slug,
				'name'     => $slug,
			)
		);
	}
}
