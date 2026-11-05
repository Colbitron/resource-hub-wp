<?php
/**
 * Anonymous visitors get a 404 from every theme page; logged-in users and robots.txt pass (ADR 0031).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Lockdown;

use ResourceHub\ContentModel\PostType;
use ResourceHub\Lockdown\Gate;
use WP_Query;

/**
 * Each route the theme renders, as an anonymous visitor and then logged in, through `go_to()`,
 * which runs `wp()` and so the `pre_handle_404` filter the gate sits on.
 */
final class GateTest extends LockdownTestCase {
	/**
	 * The gate sits on `pre_handle_404` ahead of the default priority.
	 */
	public function test_hooked_before_the_default_priority(): void {
		$this->assertSame( 0, has_filter( 'pre_handle_404', array( $this->registered_gate(), 'lock' ) ) );
	}

	/**
	 * A single resource at its mirrored path.
	 */
	public function test_single_resource(): void {
		$url = get_permalink( $this->resource() );

		$this->go_to( $url );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_singular() );

		$this->logged_in();
		$this->go_to( $url );
		$this->assertFalse( is_404() );
		$this->assertTrue( is_singular( PostType::NAME ) );
	}

	/**
	 * A post and a page of the other post types.
	 */
	public function test_posts_and_pages(): void {
		$post = get_permalink( self::factory()->post->create( array( 'post_name' => 'hello-there' ) ) );
		$page = get_permalink(
			self::factory()->post->create(
				array(
					'post_type' => 'page',
					'post_name' => 'about',
				)
			)
		);

		$this->go_to( $post );
		$this->assertTrue( is_404() );
		$this->go_to( $page );
		$this->assertTrue( is_404() );

		$this->logged_in();
		$this->go_to( $post );
		$this->assertTrue( is_single() );
		$this->go_to( $page );
		$this->assertTrue( is_page() );
	}

	/**
	 * The resource archive and a type archive.
	 */
	public function test_archives(): void {
		$this->resource();
		$archive = get_post_type_archive_link( PostType::NAME );
		$type    = get_term_link( 'ebook', 'resource_type' );

		$this->go_to( $archive );
		$this->assertTrue( is_404() );
		$this->go_to( $type );
		$this->assertTrue( is_404() );

		$this->logged_in();
		$this->go_to( $archive );
		$this->assertTrue( is_post_type_archive( PostType::NAME ) );
		$this->go_to( $type );
		$this->assertTrue( is_tax( 'resource_type', 'ebook' ) );
	}

	/**
	 * The front page.
	 */
	public function test_front_page(): void {
		$this->go_to( home_url( '/' ) );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_front_page() );

		$this->logged_in();
		$this->go_to( home_url( '/' ) );
		$this->assertTrue( is_front_page() );
	}

	/**
	 * The request is marked as the error 404 `parse_request()` gives an unmatched path, which is
	 * what makes `send_headers()` send the status, the no-cache headers and the HTML content type.
	 */
	public function test_marked_as_an_error_404_for_send_headers(): void {
		$url = get_permalink( $this->resource() );

		$this->go_to( $url );
		$this->assertSame( '404', $GLOBALS['wp']->query_vars['error'] );

		$this->logged_in();
		$this->go_to( $url );
		$this->assertArrayNotHasKey( 'error', $GLOBALS['wp']->query_vars );
	}

	/**
	 * The site feed and a resource's comments feed are 404 pages, not feeds.
	 */
	public function test_feeds(): void {
		$feed     = get_feed_link();
		$comments = get_post_comments_feed_link( $this->resource() );

		$this->go_to( $feed );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_feed() );
		$this->assertSame( '404', $GLOBALS['wp']->query_vars['error'] );
		$this->go_to( $comments );
		$this->assertTrue( is_404() );

		$this->logged_in();
		$this->go_to( $feed );
		$this->assertTrue( is_feed() );
		$this->assertFalse( is_404() );
	}

	/**
	 * Core sitemaps are off for an anonymous visitor, so their renderer sends its own 404 instead of
	 * XML; for a logged-in user they stay on.
	 */
	public function test_sitemaps(): void {
		$this->go_to( home_url( '/wp-sitemap.xml' ) );
		$this->assertTrue( is_404() );
		$this->assertFalse( wp_sitemaps_get_server()->sitemaps_enabled() );

		$this->logged_in();
		$this->go_to( home_url( '/wp-sitemap.xml' ) );
		$this->assertFalse( is_404() );
		$this->assertTrue( wp_sitemaps_get_server()->sitemaps_enabled() );
	}

	/**
	 * Author, search and date pages.
	 */
	public function test_author_search_and_date_pages(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		self::factory()->post->create(
			array(
				'post_author' => $author_id,
				'post_date'   => '2026-03-01 10:00:00',
			)
		);
		$author = get_author_posts_url( $author_id );
		$search = home_url( '/?s=handbook' );
		$year   = get_year_link( 2026 );

		foreach ( array( $author, $search, $year ) as $url ) {
			$this->go_to( $url );
			$this->assertTrue( is_404(), $url );
		}

		$this->logged_in();
		$this->go_to( $author );
		$this->assertTrue( is_author() );
		$this->go_to( $search );
		$this->assertTrue( is_search() );
		$this->go_to( $year );
		$this->assertTrue( is_year() );
	}

	/**
	 * The plain `?p=`, `?post_type=…&p=` and `?page_id=` queries.
	 */
	public function test_plain_queries(): void {
		$post_id  = self::factory()->post->create();
		$page_id  = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$post     = home_url( '/?p=' . $post_id );
		$resource = home_url( '/?post_type=resource&p=' . $this->resource() );
		$page     = home_url( '/?page_id=' . $page_id );

		foreach ( array( $post, $resource, $page ) as $url ) {
			$this->go_to( $url );
			$this->assertTrue( is_404(), $url );
		}

		$this->logged_in();
		$this->go_to( $post );
		$this->assertTrue( is_single( $post_id ) );
		$this->go_to( $resource );
		$this->assertTrue( is_singular( PostType::NAME ) );
		$this->go_to( $page );
		$this->assertTrue( is_page( $page_id ) );
	}

	/**
	 * The embed page and the favicon, which core would otherwise render and redirect respectively.
	 */
	public function test_embeds_and_favicon(): void {
		$embed = get_post_embed_url( $this->resource() );

		$this->go_to( $embed );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_embed() );
		$this->go_to( home_url( '/favicon.ico' ) );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_favicon() );

		$this->logged_in();
		$this->go_to( $embed );
		$this->assertTrue( is_embed() );
		$this->go_to( home_url( '/favicon.ico' ) );
		$this->assertTrue( is_favicon() );
	}

	/**
	 * `?preview=true` exempts nothing on its own; a logged-in preview is untouched.
	 */
	public function test_previews(): void {
		$url = add_query_arg( 'preview', 'true', get_permalink( $this->resource() ) );

		$this->go_to( $url );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_preview() );

		$this->logged_in();
		$this->go_to( $url );
		$this->assertTrue( is_preview() );
		$this->assertFalse( is_404() );
	}

	/**
	 * `robots.txt` stays reachable, because it is what tells crawlers to go away.
	 */
	public function test_robots_txt_passes(): void {
		$this->go_to( home_url( '/robots.txt' ) );

		$this->assertTrue( is_robots() );
		$this->assertFalse( is_404() );
		$this->assertArrayNotHasKey( 'error', $GLOBALS['wp']->query_vars );
	}

	/**
	 * A parameter that is not a query var never reaches the query, so `robots.txt` with one is still
	 * `robots.txt`; a public query var makes it a theme request, and a 404.
	 */
	public function test_robots_txt_with_another_parameter(): void {
		$this->go_to( home_url( '/robots.txt?utm_source=probe' ) );
		$this->assertTrue( is_robots() );
		$this->assertFalse( is_404() );

		$this->go_to( home_url( '/robots.txt?feed=rss2' ) );
		$this->assertLocked( '/robots.txt?feed=rss2' );
	}

	/**
	 * `robots` is a public query var, so anyone can add it to any URL; added to a sitemap, feed or
	 * attachment URL, it exempts nothing.
	 *
	 * @dataProvider robots_bypass_urls
	 *
	 * @param string $path Path and query, with `{attachment}` for an attachment's ID.
	 */
	public function test_robots_query_var_exempts_nothing_else( string $path ): void {
		// Registers the `sitemap` query var, as `init` does on a real request; the test case resets it.
		wp_sitemaps_get_server();
		$this->resource();
		$attachment = self::factory()->attachment->create_object(
			'pixel.png',
			0,
			array( 'post_mime_type' => 'image/png' )
		);
		$path       = str_replace( '{attachment}', (string) $attachment, $path );

		$this->go_to( home_url( $path ) );

		$this->assertLocked( $path );
		$this->assertFalse( wp_sitemaps_get_server()->sitemaps_enabled(), $path );
	}

	/**
	 * The URLs that got past the gate when `is_robots()` alone exempted a request.
	 *
	 * @return array<string, array{string}>
	 */
	public static function robots_bypass_urls(): array {
		return array(
			'sitemap index'    => array( '/wp-sitemap.xml?robots=1' ),
			'resource sitemap' => array( '/wp-sitemap-posts-resource-1.xml?robots=1' ),
			'users sitemap'    => array( '/wp-sitemap-users-1.xml?robots=1' ),
			'plain sitemap'    => array( '/?robots=1&sitemap=index' ),
			'plain attachment' => array( '/?attachment_id={attachment}&robots=1' ),
			'plain feed'       => array( '/?robots=1&feed=rss2' ),
			'empty sitemap'    => array( '/?robots=1&sitemap=' ),
			'preview'          => array( '/?robots=1&preview=true' ),
			'plain post'       => array( '/?robots=1&p=1' ),
			'sitemap XSL'      => array( '/wp-sitemap.xsl?robots=1' ),
			'index XSL'        => array( '/wp-sitemap-index.xsl?robots=1' ),
		);
	}

	/**
	 * The 404's head links to no feed and no RSD endpoint; a logged-in user's page keeps its feed
	 * links. It has no RSD link either: XML-RPC is off for everyone (ADR 0044), which
	 * {@see \ResourceHub\Tests\Security\XmlRpcTest} covers, so the link is gone before the gate runs;
	 * {@see self::test_the_gate_drops_the_rsd_link_itself()} covers the gate's own removal.
	 */
	public function test_the_404_head_advertises_no_feeds(): void {
		add_theme_support( 'automatic-feed-links' );
		$url = get_permalink( $this->resource() );

		$this->go_to( $url );
		$head = get_echo( 'wp_head' );
		$this->assertTrue( is_404() );
		$this->assertStringNotContainsString( 'application/rss+xml', $head );
		$this->assertStringNotContainsString( 'EditURI', $head );

		$this->logged_in();
		$this->go_to( $url );
		$head = get_echo( 'wp_head' );
		$this->assertStringContainsString( 'application/rss+xml', $head );
	}

	/**
	 * The gate drops the RSD link itself, whatever the XML-RPC switch does: with the link put back,
	 * locking an anonymous request takes it off `wp_head` again. The gate is called directly,
	 * because `go_to()` restores the hooks backed up at `set_up()` and so would drop the link the
	 * test adds before the gate ever saw it.
	 */
	public function test_the_gate_drops_the_rsd_link_itself(): void {
		add_action( 'wp_head', 'rsd_link' );
		$this->assertSame( 10, has_action( 'wp_head', 'rsd_link' ), 'The setup must put the link back.' );

		$this->anonymous();
		$this->assertTrue( ( new Gate() )->lock( false, new WP_Query() ) );

		$this->assertFalse( has_action( 'wp_head', 'rsd_link' ) );
	}

	/**
	 * The gate ignores an earlier callback's claim to have handled the request: anonymous is 404.
	 */
	public function test_an_earlier_handler_does_not_exempt_anonymous_visitors(): void {
		$this->go_to( get_permalink( $this->resource() ) );
		$query = $GLOBALS['wp_query'];

		$this->assertTrue( ( new Gate() )->lock( true, $query ) );
		$this->assertTrue( $query->is_404() );
	}

	/**
	 * Something that is not the main query is passed through untouched.
	 */
	public function test_passes_through_without_a_query(): void {
		$this->assertSame( 'kept', ( new Gate() )->lock( 'kept', null ) );
	}

	/**
	 * The 404 has found nothing: whatever the main query had, a template that loops cannot show it,
	 * even though the query's own arguments do find the resource.
	 */
	public function test_the_404_has_found_nothing(): void {
		$id = $this->resource();

		$this->go_to( get_permalink( $id ) );
		$query = $GLOBALS['wp_query'];

		$this->assertTrue( $query->is_404() );
		$this->assertFalse( $query->have_posts() );
		$this->assertSame( array(), $query->posts );
		$this->assertSame( 0, $query->post_count );
		$this->assertSame( 0, $query->found_posts );
		$this->assertNull( $query->get_queried_object() );
		$this->assertSame( $id, ( new WP_Query( $query->query ) )->posts[0]->ID, 'Core alone would have served it.' );
	}

	/**
	 * The request is the gate's 404, and nothing would redirect it: the canonical redirect finds no
	 * URL, and `wp_redirect()`, which would send the `Location` header, is muted
	 * ({@see NoRedirectsTest::test_wp_redirect_sends_nothing()}).
	 *
	 * @param string $path Path requested, for the failure message.
	 */
	private function assertLocked( string $path ): void {
		$url = home_url( $path );

		$this->assertTrue( is_404(), $path );
		$this->assertFalse( is_robots(), $path );
		$this->assertFalse( is_feed(), $path );
		$this->assertSame( '404', $GLOBALS['wp']->query_vars['error'], $path );
		$this->assertNull( redirect_canonical( $url, false ), $path );
		$this->assertSame( 10, has_filter( 'wp_redirect', '__return_false' ), $path );
	}

	/**
	 * The gate instance the plugin registered.
	 */
	private function registered_gate(): Gate {
		return $this->registered( 'pre_handle_404', Gate::class, 0 );
	}
}
