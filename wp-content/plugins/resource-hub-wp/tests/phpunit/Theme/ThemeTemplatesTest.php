<?php
/**
 * The theme's templates are the ones core resolves for each kind of request.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Theme;

use WP_UnitTestCase;

/**
 * Which of `wp-content/themes/resource-hub/templates/` core renders for a request.
 *
 * The theme has no `front-page.html` on purpose: core would use one for `/` whether or not
 * Settings > Reading names a static front page, so it could not be both the page and the welcome.
 * So `/` resolves to `home.html` (the front end's welcome page) while the front page shows posts and
 * to `page.html` when it is a page; the theme's README has the reasoning. These tests pin that, and
 * the other templates, through core's own resolution: the request is set up with `go_to()`, the
 * template getters run in `wp-includes/template-loader.php`'s order, and the block template core
 * picks is read back from `$_wp_current_template_id`, which `locate_block_template()` sets. A
 * `front-page.html` added to the theme fails the first test. Each test also renders the template,
 * as core does (`get_the_block_template_html()`), and holds it to one `h1`.
 *
 * The PHPUnit bootstrap leaves the tests site on core's test theme, so each test switches to the
 * theme and adds core's block-template loader filters, which core adds on `wp_loaded` only when the
 * active theme is a block theme. It runs as an editor, since the lockdown answers an anonymous
 * request for a theme page with its 404.
 */
final class ThemeTemplatesTest extends WP_UnitTestCase {
	/**
	 * `template-loader.php`'s conditionals and getters, in its order.
	 */
	private const TAG_TEMPLATES = array(
		'is_embed'             => 'get_embed_template',
		'is_404'               => 'get_404_template',
		'is_search'            => 'get_search_template',
		'is_front_page'        => 'get_front_page_template',
		'is_home'              => 'get_home_template',
		'is_privacy_policy'    => 'get_privacy_policy_template',
		'is_post_type_archive' => 'get_post_type_archive_template',
		'is_tax'               => 'get_taxonomy_template',
		'is_attachment'        => 'get_attachment_template',
		'is_single'            => 'get_single_template',
		'is_page'              => 'get_page_template',
		'is_singular'          => 'get_singular_template',
		'is_category'          => 'get_category_template',
		'is_tag'               => 'get_tag_template',
		'is_author'            => 'get_author_template',
		'is_date'              => 'get_date_template',
		'is_archive'           => 'get_archive_template',
	);

	/**
	 * The last page `assertOneHeading()` rendered, as core renders a block template.
	 *
	 * @var string
	 */
	private string $html = '';

	/**
	 * The theme, its block-template loader, and an editor, with Settings > Reading showing posts and
	 * naming no posts page.
	 */
	public function set_up(): void {
		parent::set_up();
		switch_theme( 'resource-hub' );
		add_theme_support( 'block-templates' );
		_add_template_loader_filters();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		update_option( 'show_on_front', 'posts' );
		update_option( 'page_for_posts', 0 );
	}

	/**
	 * `/` while the front page shows posts is the welcome, `home.html`.
	 */
	public function test_posts_on_front_is_the_welcome(): void {
		$this->assertSame( 'resource-hub//home', $this->template_for( home_url( '/' ) ) );
		$this->assertOneHeading( 'Resource Hub' );
	}

	/**
	 * A static front page is a page, `page.html`.
	 */
	public function test_static_front_page_is_the_page(): void {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $page );

		$this->assertSame( 'resource-hub//page', $this->template_for( home_url( '/' ) ) );
		$this->assertTrue( is_front_page() );
		$this->assertOneHeading( get_the_title( $page ) );
	}

	/**
	 * A front page set to a page but with no page chosen is the welcome, `home.html`, as the front
	 * end shows its welcome then: core reads it as the posts index.
	 */
	public function test_page_on_front_without_a_page_is_the_welcome(): void {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', 0 );

		$this->assertSame( 'resource-hub//home', $this->template_for( home_url( '/' ) ) );
		$this->assertFalse( is_front_page() );
		$this->assertOneHeading( 'Resource Hub' );
	}

	/**
	 * The posts page under a static front page is the 404, `404.html`, as the front end answers it: its
	 * page route never serves the page `page_for_posts` names while `show_on_front` is `page`
	 * (`PagePath::is_served()`), so the plugin's `PostsPage` makes the CMS's request a 404 too, by path and
	 * by `page_id`, and its later pages with it. Core alone would render `home.html` for it.
	 */
	public function test_posts_page_under_a_static_front_page_is_the_404(): void {
		$front = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$posts = self::factory()->post->create(
			array(
				'post_type'  => 'page',
				'post_title' => 'Blog',
			)
		);
		self::factory()->post->create();
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $front );
		update_option( 'page_for_posts', $posts );

		$this->assertSame( 'resource-hub//404', $this->template_for( get_permalink( $posts ) ) );
		$this->assertTrue( is_404() );
		$this->assertFalse( is_home() );
		$this->assertOneHeading( 'Page not found' );

		$this->assertSame( 'resource-hub//404', $this->template_for( home_url( '/?page_id=' . $posts . '&paged=2' ) ), 'Its later pages too.' );
		$this->assertTrue( is_404() );

		// The front page is still the page, and `/` is not touched.
		$this->assertSame( 'resource-hub//page', $this->template_for( home_url( '/' ) ) );
		$this->assertTrue( is_front_page() );
	}

	/**
	 * The page `page_for_posts` names is an ordinary page while the front page shows posts: core reads
	 * the option only under a static front page, and so does the front end's page route.
	 */
	public function test_page_for_posts_is_a_page_while_posts_show_on_front(): void {
		$posts = self::factory()->post->create(
			array(
				'post_type'  => 'page',
				'post_title' => 'Blog',
			)
		);
		update_option( 'show_on_front', 'posts' );
		update_option( 'page_for_posts', $posts );

		$this->assertSame( 'resource-hub//page', $this->template_for( get_permalink( $posts ) ) );
		$this->assertFalse( is_404() );
		$this->assertOneHeading( 'Blog' );
	}

	/**
	 * Any other page is `page.html`.
	 */
	public function test_page_is_the_page(): void {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );

		$this->assertSame( 'resource-hub//page', $this->template_for( get_permalink( $page ) ) );
		$this->assertOneHeading( get_the_title( $page ) );
	}

	/**
	 * A single post is `singular.html`, the page's article, so it has the page's one `h1` rather than a
	 * list's `h2`.
	 */
	public function test_post_is_singular(): void {
		$post = self::factory()->post->create();

		$this->assertSame( 'resource-hub//singular', $this->template_for( get_permalink( $post ) ) );
		$this->assertOneHeading( get_the_title( $post ) );
	}

	/**
	 * A resource is `single-resource.html`, the front end's resource article, with its title the page's
	 * one `h1`. Factory-made, so it needs no type, topic or summary (`OneType` and `RequiredFields`
	 * guard the save paths, not the factory); its permalink is the plain `?resource=` form the tests
	 * site's permalinks give. Without a type the plugin's blocks for the meta line, the summary, the
	 * source and the related section render nothing, so the article is the title and the body.
	 */
	public function test_resource_is_the_single_resource(): void {
		$resource = self::factory()->post->create(
			array(
				'post_type'  => 'resource',
				'post_title' => 'A sample resource',
			)
		);

		$this->assertSame( 'resource-hub//single-resource', $this->template_for( get_permalink( $resource ) ) );
		$this->assertTrue( is_singular( 'resource' ) );
		$this->assertOneHeading( 'A sample resource' );
		$this->assertMatchesRegularExpression( '/<article class="wp-block-group rh-resource[^"]*">/', $this->html );
		$this->assertStringContainsString( '<h1 class="rh-resource__title wp-block-post-title">', $this->html );
		$this->assertStringContainsString( 'rh-resource__body rh-prose', $this->html );
		$this->assertStringNotContainsString( 'rh-page', $this->html );
	}

	/**
	 * A resource with a type and a summary renders the plugin's blocks in the article's order: the
	 * meta line in the header under the title, the summary before the body, and the related section
	 * after it, each the front end's markup.
	 */
	public function test_single_resource_renders_the_article_blocks_in_order(): void {
		$type  = self::factory()->term->create( array( 'taxonomy' => 'resource_type' ) );
		$topic = self::factory()->term->create( array( 'taxonomy' => 'resource_topic' ) );
		$other = self::factory()->post->create(
			array(
				'post_type'  => 'resource',
				'post_title' => 'Another resource',
			)
		);
		wp_set_object_terms( $other, array( $type ), 'resource_type' );
		wp_set_object_terms( $other, array( $topic ), 'resource_topic' );
		$resource = self::factory()->post->create(
			array(
				'post_type'    => 'resource',
				'post_title'   => 'A typed resource',
				'post_content' => '<!-- wp:paragraph --><p>The body.</p><!-- /wp:paragraph -->',
			)
		);
		wp_set_object_terms( $resource, array( $type ), 'resource_type' );
		wp_set_object_terms( $resource, array( $topic ), 'resource_topic' );
		update_post_meta( $resource, 'summary', 'The summary.' );
		update_post_meta( $resource, 'source_url', 'https://example.com/guide' );

		$this->assertSame( 'resource-hub//single-resource', $this->template_for( get_permalink( $resource ) ) );
		$this->assertOneHeading( 'A typed resource' );

		$order    = array(
			'<h1 class="rh-resource__title wp-block-post-title">',
			'<div class="rh-resource__meta">',
			'</header>',
			'<p class="rh-resource__summary">The summary.</p>',
			'rh-resource__body rh-prose',
			'>The body.</p>',
			'<footer class="rh-resource__source"><p>Source: <a href="https://example.com/guide" rel="noopener noreferrer">example.com</a></p></footer>',
			'<section class="rh-related" aria-labelledby="rh-related-heading">',
			'Another resource',
			'</article>',
		);
		$position = -1;

		foreach ( $order as $needle ) {
			$found = strpos( $this->html, $needle, $position + 1 );
			$this->assertNotFalse( $found, "{$needle} is not in the page after position {$position}." );
			$position = $found;
		}
	}

	/**
	 * The library is `archive-resource.html`: the collection head's `h1`, each resource a row.
	 */
	public function test_library_is_the_resource_archive(): void {
		$this->collection_content();

		$this->assertSame( 'resource-hub//archive-resource', $this->template_for( get_post_type_archive_link( 'resource' ) ) );
		$this->assertTrue( is_post_type_archive( 'resource' ) );
		$this->assertOneHeading( 'Resources' );
		$this->assertSame( 2, substr_count( $this->html, '<article class="rh-card">' ) );
		$this->assertStringContainsString( 'rh-filters', $this->html );
		// One page: core's pagination block prints nothing, as the front end's `Pagination` renders nothing for a single page.
		$this->assertStringNotContainsString( 'wp-block-query-pagination', $this->html );
	}

	/**
	 * A type is `taxonomy-resource_type.html`, headed as the front end heads it.
	 */
	public function test_type_is_the_type_taxonomy_template(): void {
		$this->collection_content();

		$this->assertSame( 'resource-hub//taxonomy-resource_type', $this->template_for( get_term_link( 'webinar', 'resource_type' ) ) );
		$this->assertOneHeading( 'Webinar resources' );
		$this->assertSame( 1, substr_count( $this->html, '<article class="rh-card">' ) );
	}

	/**
	 * A topic is `taxonomy-resource_topic.html`.
	 */
	public function test_topic_is_the_topic_taxonomy_template(): void {
		$this->collection_content();

		$this->assertSame( 'resource-hub//taxonomy-resource_topic', $this->template_for( get_term_link( 'caching', 'resource_topic' ) ) );
		$this->assertOneHeading( 'Resources on Caching' );
		$this->assertSame( 2, substr_count( $this->html, '<article class="rh-card">' ) );
	}

	/**
	 * A type within a topic sets both taxonomies' query vars. Core resolves the template of the taxonomy
	 * whose term is the queried object, the first of the two in its taxonomy order, which the tests
	 * re-register in varying orders; the two templates are the same shell around the collection part
	 * (`test_collection_templates_are_identical()` holds them to it), so either is right, and the head
	 * names both terms.
	 */
	public function test_type_within_topic_is_a_taxonomy_template(): void {
		$this->collection_content();

		$this->assertContains(
			$this->template_for( home_url( '/?resource_type=webinar&resource_topic=caching' ) ),
			array( 'resource-hub//taxonomy-resource_type', 'resource-hub//taxonomy-resource_topic' )
		);
		$this->assertTrue( is_tax() );
		$this->assertSame( 'webinar', get_query_var( 'resource_type' ) );
		$this->assertSame( 'caching', get_query_var( 'resource_topic' ) );
		$this->assertOneHeading( 'Webinar resources on Caching' );
		$this->assertSame( 1, substr_count( $this->html, '<article class="rh-card">' ) );
	}

	/**
	 * The three collection templates are the same file byte for byte: the shell around the collection part.
	 * Core picks one of the two taxonomy templates for a type within a topic by its taxonomy order, which
	 * no one sets (`test_type_within_topic_is_a_taxonomy_template()`), so that pick may not matter; a change
	 * to one template is a change to all three, or a way to tell them apart that this test should name.
	 */
	public function test_collection_templates_are_identical(): void {
		$dir      = WP_CONTENT_DIR . '/themes/resource-hub/templates/';
		$library  = $dir . 'archive-resource.html';
		$template = (string) file_get_contents( $library ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- The theme's own template, read by a test.
		$this->assertStringContainsString( '<!-- wp:template-part {"slug":"collection"} /-->', $template );

		foreach ( array( 'taxonomy-resource_type.html', 'taxonomy-resource_topic.html' ) as $file ) {
			$this->assertFileIsReadable( $dir . $file );
			$this->assertSame( $template, file_get_contents( $dir . $file ), "{$file} differs from archive-resource.html." ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- The theme's own template, read by a test.
		}
	}

	/**
	 * An archive is `index.html`, under the archive's title as its one `h1`, its posts' titles `h2`.
	 */
	public function test_archive_is_the_index(): void {
		$category = self::factory()->category->create( array( 'name' => 'Guides' ) );
		self::factory()->post->create( array( 'post_category' => array( $category ) ) );

		$this->assertSame( 'resource-hub//index', $this->template_for( get_category_link( $category ) ) );
		$this->assertOneHeading( 'Category: Guides' );
		$this->assertStringContainsString( '<h2 class="rh-page__title wp-block-post-title">', $this->html );
	}

	/**
	 * Search has no template of its own yet, so `index.html`.
	 */
	public function test_search_is_the_index(): void {
		self::factory()->post->create( array( 'post_title' => 'A guide' ) );

		$this->assertSame( 'resource-hub//index', $this->template_for( home_url( '/?s=guide' ) ) );
		$this->assertOneHeading( 'Search results for: “guide”' );
	}

	/**
	 * A missing page is `404.html`.
	 */
	public function test_missing_page_is_the_404(): void {
		$this->assertSame( 'resource-hub//404', $this->template_for( home_url( '/?page_id=987654' ) ) );
		$this->assertTrue( is_404() );
		$this->assertOneHeading( 'Page not found' );
	}

	/**
	 * Two published resources: an ebook and a webinar, both on the topic "Caching". Plain permalinks, so each
	 * collection is requested by its query vars, as core's term links give them.
	 */
	private function collection_content(): void {
		$ebook   = self::factory()->term->create(
			array(
				'taxonomy' => 'resource_type',
				'slug'     => 'ebook',
				'name'     => 'Ebook',
			)
		);
		$webinar = self::factory()->term->create(
			array(
				'taxonomy' => 'resource_type',
				'slug'     => 'webinar',
				'name'     => 'Webinar',
			)
		);
		$caching = self::factory()->term->create(
			array(
				'taxonomy' => 'resource_topic',
				'slug'     => 'caching',
				'name'     => 'Caching',
			)
		);

		foreach ( array( $ebook, $webinar ) as $type ) {
			$id = self::factory()->post->create(
				array(
					'post_type'   => 'resource',
					'post_status' => 'publish',
					'post_title'  => 'A resource',
				)
			);
			wp_set_object_terms( $id, array( $type ), 'resource_type' );
			wp_set_object_terms( $id, array( $caching ), 'resource_topic' );
		}
	}

	/**
	 * The rendered template has one `h1`, and it says `$text`.
	 *
	 * @param string $text The heading's text, entities decoded and tags stripped.
	 */
	private function assertOneHeading( string $text ): void {
		$this->html = get_the_block_template_html();
		$this->assertSame( 1, preg_match_all( '/<h1\b[^>]*>(.*?)<\/h1>/s', $this->html, $matches ), $this->html );
		$this->assertSame( $text, html_entity_decode( wp_strip_all_tags( $matches[1][0] ), ENT_QUOTES ) );
	}

	/**
	 * The block template core resolves for `$url`, as `template-loader.php` would.
	 *
	 * @param string $url The request.
	 * @return string The template's ID, `theme//slug`.
	 */
	private function template_for( string $url ): string {
		// Core's record of the block template it resolved; reset between requests, as a new PHP request starts.
		$GLOBALS['_wp_current_template_id'] = null; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited, WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- core's own global, reset as a new request would.

		$this->go_to( $url );

		$template = '';
		foreach ( self::TAG_TEMPLATES as $tag => $getter ) {
			if ( call_user_func( $tag ) ) {
				$template = call_user_func( $getter );
			}
			if ( $template ) {
				break;
			}
		}
		if ( ! $template ) {
			get_index_template();
		}

		$resolved = $GLOBALS['_wp_current_template_id'];
		$this->assertIsString( $resolved, "No block template resolved for {$url}." );

		return $resolved;
	}
}
