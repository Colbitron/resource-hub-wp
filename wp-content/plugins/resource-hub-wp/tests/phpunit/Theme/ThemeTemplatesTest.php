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
	 * The theme, its block-template loader, and an editor.
	 */
	public function set_up(): void {
		parent::set_up();
		switch_theme( 'resource-hub' );
		add_theme_support( 'block-templates' );
		_add_template_loader_filters();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		update_option( 'show_on_front', 'posts' );
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
	 * Any other page is `page.html`.
	 */
	public function test_page_is_the_page(): void {
		$page = self::factory()->post->create( array( 'post_type' => 'page' ) );

		$this->assertSame( 'resource-hub//page', $this->template_for( get_permalink( $page ) ) );
		$this->assertOneHeading( get_the_title( $page ) );
	}

	/**
	 * A single post, or a resource until its own template lands, is `singular.html`, the page's
	 * article, so it has the page's one `h1` rather than a list's `h2`.
	 */
	public function test_post_is_singular(): void {
		$post = self::factory()->post->create();

		$this->assertSame( 'resource-hub//singular', $this->template_for( get_permalink( $post ) ) );
		$this->assertOneHeading( get_the_title( $post ) );
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
