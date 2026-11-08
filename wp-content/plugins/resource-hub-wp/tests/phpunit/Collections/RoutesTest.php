<?php
/**
 * The collection paths resolve on the CMS as they do on the front end.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Collections;

use ResourceHub\Collections\Routes;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_UnitTestCase;

/**
 * Each of the front end's listing paths (`packages/ui/README.md`, "Public URL shape") reaches the main query the
 * collection templates render from, a single resource still reaches its page, and anonymous visitors get the
 * lockdown's 404 on every one of them.
 */
final class RoutesTest extends WP_UnitTestCase {
	use MakesCollections;

	/**
	 * Pretty permalinks with the rules, and a logged-in reader, since the lockdown answers anonymous requests with a 404.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_pretty_permalinks();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
	}

	/**
	 * Back to plain permalinks.
	 */
	public function tear_down(): void {
		$this->use_plain_permalinks();
		parent::tear_down();
	}

	/**
	 * The five rules are in the regenerated rules, at the top, each mapping to the taxonomies' query vars.
	 */
	public function test_rules_are_added_at_the_top(): void {
		global $wp_rewrite;

		$rules = $wp_rewrite->wp_rewrite_rules();
		$keys  = array_keys( $rules );

		foreach ( Routes::rules() as $pattern => $query ) {
			$this->assertArrayHasKey( $pattern, $rules );
			$this->assertSame( $query, $rules[ $pattern ] );
			$this->assertLessThan(
				array_search( 'resources/([^/]+)/([^/]+)(?:/([0-9]+))?/?$', $keys, true ),
				array_search( $pattern, $keys, true ),
				"{$pattern} sits above the single resource's rule."
			);
		}

		$this->assertSame(
			'index.php?resource_topic=$matches[1]',
			$rules['resources/topic/([^/]+)/?$']
		);
		$this->assertSame(
			'index.php?resource_type=$matches[1]&resource_topic=$matches[2]&paged=$matches[3]',
			$rules['resources/([^/]+)/topic/([^/]+)/page/([0-9]{1,})/?$']
		);
	}

	/**
	 * `/resources/topic/{topic}/` is the topic's archive.
	 */
	public function test_topic_collection(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );

		$this->go_to( home_url( '/resources/topic/caching/' ) );

		$this->assertFalse( is_404() );
		$this->assertTrue( is_tax( Taxonomies::TOPIC, 'caching' ) );
		$this->assertFalse( is_tax( Taxonomies::TYPE ) );
		$this->assertSame( 'caching', get_query_var( Taxonomies::TOPIC ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->found_posts );
	}

	/**
	 * `/resources/{type}/topic/{topic}/` is both taxonomies at once: only resources with the type and the topic.
	 */
	public function test_type_within_topic_collection(): void {
		$both = $this->resource( 'Both', 'ebook', array( 'caching' ) );
		$this->resource( 'Type only', 'ebook', array( 'testing' ) );
		$this->resource( 'Topic only', 'webinar', array( 'caching' ) );

		$this->go_to( home_url( '/resources/ebook/topic/caching/' ) );

		$this->assertFalse( is_404() );
		$this->assertTrue( is_tax() );
		// `is_tax()` with a term reads the queried object, which is the topic, the first taxonomy registered; the vars hold both.
		$this->assertSame( 'ebook', get_query_var( Taxonomies::TYPE ) );
		$this->assertSame( 'caching', get_query_var( Taxonomies::TOPIC ) );
		$this->assertTrue( is_tax( Taxonomies::TOPIC, 'caching' ) );
		$this->assertSame( array( $both ), wp_list_pluck( $GLOBALS['wp_query']->posts, 'ID' ) );
	}

	/**
	 * The type collection core already answers, and its later pages, which the single resource's rule used to take.
	 */
	public function test_type_collection_and_its_pages(): void {
		for ( $i = 1; $i <= 13; $i++ ) {
			$this->resource( "Ebook {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}

		$this->go_to( home_url( '/resources/ebook/' ) );
		$this->assertTrue( is_tax( Taxonomies::TYPE, 'ebook' ) );
		$this->assertSame( 13, $GLOBALS['wp_query']->found_posts );
		$this->assertSame( 2, $GLOBALS['wp_query']->max_num_pages, 'Twelve to a page, the front end\'s count.' );

		$this->go_to( home_url( '/resources/ebook/page/2/' ) );
		$this->assertFalse( is_404() );
		$this->assertFalse( is_singular(), 'Not a resource named "page".' );
		$this->assertTrue( is_tax( Taxonomies::TYPE, 'ebook' ) );
		$this->assertTrue( is_paged() );
		$this->assertSame( 2, get_query_var( 'paged' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count );

		$this->go_to( home_url( '/resources/ebook/page/3/' ) );
		$this->assertTrue( is_404(), 'A page past the last is a 404, as on the front end.' );
	}

	/**
	 * The later pages of a topic and of a type within a topic.
	 */
	public function test_topic_pages(): void {
		for ( $i = 1; $i <= 13; $i++ ) {
			$this->resource( "Caching {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}

		$this->go_to( home_url( '/resources/topic/caching/page/2/' ) );
		$this->assertFalse( is_404() );
		$this->assertTrue( is_tax( Taxonomies::TOPIC, 'caching' ) );
		$this->assertSame( 2, get_query_var( 'paged' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count );

		$this->go_to( home_url( '/resources/ebook/topic/caching/page/2/' ) );
		$this->assertFalse( is_404() );
		$this->assertSame( 'ebook', get_query_var( Taxonomies::TYPE ) );
		$this->assertTrue( is_tax( Taxonomies::TOPIC, 'caching' ) );
		$this->assertSame( 2, get_query_var( 'paged' ) );
		$this->assertSame( 1, $GLOBALS['wp_query']->post_count );
	}

	/**
	 * The library's own pages still go to the archive rule core writes.
	 */
	public function test_library_pages_are_the_archive(): void {
		for ( $i = 1; $i <= 13; $i++ ) {
			$this->resource( "Resource {$i}", 'ebook', array( 'caching' ), sprintf( '2026-10-%02d 09:00:00', $i ) );
		}

		$this->go_to( home_url( '/resources/page/2/' ) );

		$this->assertTrue( is_post_type_archive( PostType::NAME ) );
		$this->assertFalse( is_tax() );
		$this->assertSame( 2, get_query_var( 'paged' ) );
	}

	/**
	 * A single resource is untouched: `/resources/{type}/{slug}/` is still its page, a slug of `topic` or `page` included.
	 */
	public function test_single_resources_still_resolve(): void {
		$id = $this->resource( 'Measuring what readers feel', 'ebook', array( 'caching' ) );

		$this->go_to( get_permalink( $id ) );
		$this->assertTrue( is_singular( PostType::NAME ) );
		$this->assertSame( $id, get_queried_object_id() );

		// A resource whose slug is a reserved word is still a resource: only type slugs are reserved.
		$named_topic = $this->resource( 'Topic', 'ebook', array( 'caching' ) );
		wp_update_post(
			array(
				'ID'        => $named_topic,
				'post_name' => 'topic',
			)
		);
		$this->go_to( home_url( '/resources/ebook/topic/' ) );
		$this->assertTrue( is_singular( PostType::NAME ) );
		$this->assertSame( $named_topic, get_queried_object_id() );
	}

	/**
	 * A topic or a type that does not exist, and the reserved words standing alone, are 404s, as on the front end.
	 */
	public function test_missing_terms_and_bare_reserved_words_are_404s(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );

		foreach ( array( '/resources/topic/no-such-topic/', '/resources/ebook/topic/no-such-topic/', '/resources/no-such-type/topic/caching/', '/resources/topic/', '/resources/page/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertTrue( is_404(), $path );
		}
	}

	/**
	 * An existing type with nothing in it, or an existing pair with nothing in common, is a 200 with no posts: the empty state, not a missing page.
	 */
	public function test_empty_collections_are_not_404s(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		$this->term( Taxonomies::TYPE, 'webinar' );
		$this->term( Taxonomies::TOPIC, 'testing' );

		foreach ( array( '/resources/webinar/', '/resources/topic/testing/', '/resources/ebook/topic/testing/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertFalse( is_404(), $path );
			$this->assertSame( 0, $GLOBALS['wp_query']->found_posts, $path );
		}
	}

	/**
	 * Anonymous visitors get the lockdown's 404 from every collection path (ADR 0031).
	 */
	public function test_anonymous_visitors_get_the_404(): void {
		$this->resource( 'A', 'ebook', array( 'caching' ) );
		wp_set_current_user( 0 );

		foreach ( array( '/resources/', '/resources/ebook/', '/resources/topic/caching/', '/resources/ebook/topic/caching/' ) as $path ) {
			$this->go_to( home_url( $path ) );
			$this->assertTrue( is_404(), $path );
			$this->assertSame( 0, $GLOBALS['wp_query']->found_posts, $path );
		}
	}
}
