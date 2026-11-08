<?php
/**
 * The `resource-hub/resource-card` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\ResourceCardBlock;
use ResourceHub\Blocks\ResourceCardMarkup;
use ResourceHub\Blocks\SharedCard;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Block;
use WP_Block_Type_Registry;
use WP_REST_Request;
use WP_UnitTestCase;

/**
 * The markup itself is `MarkupParityTest`'s (against the contract's fixture) and `RelatedResourcesBlockTest`'s
 * (the shared row's text rules); this holds the block's own rules: which post it renders, the title's
 * fallback and level, the registration, a post template and the editor's preview endpoint.
 */
final class ResourceCardBlockTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * A type term's ID.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * A topic term's ID.
	 *
	 * @var int
	 */
	private int $topic;

	/**
	 * One type and one topic, under pretty permalinks (see `RelatedResourcesBlockTest::set_up()`).
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$this->assertTrue(
			WP_Block_Type_Registry::get_instance()->is_registered( ResourceCardBlock::NAME ),
			'The block is not registered: run `pnpm build` so build/resource-card/block.json exists.'
		);

		$this->type  = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Webinar',
				'slug'     => 'webinar',
			)
		);
		$this->topic = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Testing',
				'slug'     => 'testing',
			)
		);
		self::use_type_accents(
			array(
				$this->type => array(
					'slug'   => 'webinar',
					'accent' => 'coral',
				),
			)
		);
	}

	/**
	 * Back to plain permalinks and the build's table.
	 */
	public function tear_down(): void {
		self::reset_type_accents();
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * The compiled block.json: the callback, the level, the context, no wrapper supports, the tokens and the shared row.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( ResourceCardBlock::NAME );

		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( 'integer', $type->attributes['level']['type'] );
		$this->assertSame( ResourceCardBlock::DEFAULT_LEVEL, $type->attributes['level']['default'] );
		$this->assertSame( array( 'postId', 'postType' ), $type->uses_context );
		$this->assertSame( array( 'core/post-template' ), $type->ancestor );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );

		// The related block's two shared handles and nothing of its own, so the row's rules load once.
		$this->assertSame( array( SharedTokens::HANDLE, SharedCard::HANDLE ), $type->style_handles );
		$this->assertFileDoesNotExist( dirname( __DIR__, 3 ) . '/build/resource-card/style-index.css' );
	}

	/**
	 * A published resource renders its row, with the front end's `h2` by default and no wrapper.
	 */
	public function test_renders_the_row(): void {
		$id   = $this->resource( 'Caching basics' );
		$html = $this->render( array(), $id );

		$this->assertStringStartsWith( '<article class="rh-card">', $html );
		$this->assertStringEndsWith( '</article>', $html );
		$this->assertStringContainsString( '<h2 class="rh-card__title"><a class="rh-card__link" href="' . get_permalink( $id ) . '">Caching basics</a></h2>', $html );
		$this->assertStringContainsString( '<span class="rh-card__type" data-accent="coral">Webinar</span>', $html );
		$this->assertSame( ResourceCardMarkup::row( get_post( $id ), 'Caching basics', get_term( $this->type ), 'h2' ), $html, 'The shared renderer, nothing added.' );
	}

	/**
	 * The level attribute picks the heading, clamped to 2–4, anything not a number being 2.
	 *
	 * @dataProvider level_cases
	 *
	 * @param mixed  $level    The stored attribute.
	 * @param string $expected The heading element.
	 */
	public function test_level_sets_the_heading( mixed $level, string $expected ): void {
		$html = $this->render( array( 'level' => $level ), $this->resource( 'Levels' ) );

		$this->assertStringContainsString( '<' . $expected . ' class="rh-card__title">', $html );
		$this->assertStringContainsString( '</' . $expected . '>', $html );
	}

	/**
	 * Cases for test_level_sets_the_heading().
	 *
	 * @return array<string, array{mixed, string}>
	 */
	public static function level_cases(): array {
		return array(
			'2'          => array( 2, 'h2' ),
			'3'          => array( 3, 'h3' ),
			'4'          => array( 4, 'h4' ),
			'below'      => array( 1, 'h2' ),
			'above'      => array( 9, 'h4' ),
			'numeric'    => array( '3', 'h3' ),
			'not number' => array( 'h3', 'h2' ),
			'null'       => array( null, 'h2' ),
		);
	}

	/**
	 * An empty title shows "Untitled resource", as the front end's listing row does, rather than dropping the row.
	 */
	public function test_empty_title_is_untitled(): void {
		$html = $this->render( array(), $this->resource( '&nbsp;&#8203;' ) );

		$this->assertStringContainsString( '>Untitled resource</a></h2>', $html );
	}

	/**
	 * A password-protected resource is a published one: the front end lists it and the related route
	 * answers it, so it gets its row, titled as the REST API titles it, without "Protected: ". The row
	 * shows nothing the password guards: the summary is public meta, and the content is not on it.
	 */
	public function test_password_protected_resource_renders_its_row(): void {
		$id   = $this->resource( 'Locked', array( 'post_password' => 'secret' ) );
		$html = $this->render( array(), $id );

		$this->assertStringContainsString( '<a class="rh-card__link" href="' . get_permalink( $id ) . '">Locked</a>', $html );
		$this->assertStringNotContainsString( 'Protected', $html );
	}

	/**
	 * Anything but a published resource with exactly one type renders nothing.
	 */
	public function test_renders_nothing_without_a_published_resource(): void {
		$this->assertSame( '', $this->render( array(), null ), 'No context.' );
		$this->assertSame( '', $this->render( array(), self::factory()->post->create() ), 'A post.' );
		$this->assertSame( '', $this->render( array(), self::factory()->post->create( array( 'post_type' => 'page' ) ) ), 'A page.' );

		foreach ( array( 'draft', 'pending', 'private', 'future', 'trash' ) as $status ) {
			// A future date, or core publishes a `future` post at once.
			$args = array(
				'post_status' => $status,
				'post_date'   => '2099-01-01 00:00:00',
			);
			$this->assertSame( '', $this->render( array(), $this->resource( 'Hidden', $args ) ), $status );
		}

		$untyped = $this->resource( 'No type' );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$this->assertSame( '', $this->render( array(), $untyped ), 'No type.' );

		$two   = $this->resource( 'Two types' );
		$other = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		wp_set_object_terms( $two, array( $this->type, $other ), Taxonomies::TYPE );
		$this->assertSame( '', $this->render( array(), $two ), 'Two types.' );

		$this->assertSame( '', $this->render( array(), $this->resource( 'Wrong context' ), 'post' ), 'A postType context that is not resource.' );
	}

	/**
	 * In a Query Loop's post template, each listed resource renders its own row.
	 */
	public function test_renders_each_post_in_a_post_template(): void {
		$first  = $this->resource( 'First', array( 'post_date' => '2026-10-01 00:00:00' ) );
		$second = $this->resource( 'Second', array( 'post_date' => '2026-10-02 00:00:00' ) );

		$html = do_blocks(
			'<!-- wp:query {"queryId":1,"query":{"postType":"resource","perPage":10,"inherit":false,"order":"desc","orderBy":"date"}} -->'
			. '<div class="wp-block-query"><!-- wp:post-template {"className":"rh-card-grid"} -->'
			. '<!-- wp:resource-hub/resource-card /-->'
			. '<!-- /wp:post-template --></div><!-- /wp:query -->'
		);

		$this->assertSame( 2, substr_count( $html, '<article class="rh-card">' ) );
		$this->assertMatchesRegularExpression( '/<ul class="[^"]*rh-card-grid[^"]*"/', $html, 'The post template carries the list class.' );
		$this->assertLessThan(
			strpos( $html, get_permalink( $first ) ),
			strpos( $html, get_permalink( $second ) ),
			'Each row is its own post, newest first.'
		);
	}

	/**
	 * The editor's preview endpoint renders the row for the `post_id` the editor sends.
	 */
	public function test_editor_preview_renders_the_post_it_is_sent(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$id = $this->resource( 'Previewed' );

		$request = new WP_REST_Request( 'GET', '/wp/v2/block-renderer/' . ResourceCardBlock::NAME );
		$request->set_query_params(
			array(
				'context' => 'edit',
				'post_id' => $id,
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertStringContainsString( '>Previewed</a></h2>', $response->get_data()['rendered'] );
	}

	/**
	 * A published resource with the type and topic, and optionally a summary.
	 *
	 * @param string               $title The title.
	 * @param array<string, mixed> $args  More `wp_insert_post()` arguments.
	 */
	private function resource( string $title, array $args = array() ): int {
		$id = self::factory()->post->create(
			array_merge(
				array(
					'post_type'   => PostType::NAME,
					'post_status' => 'publish',
					'post_title'  => $title,
				),
				$args
			)
		);
		wp_set_object_terms( $id, array( $this->type ), Taxonomies::TYPE );
		wp_set_object_terms( $id, array( $this->topic ), Taxonomies::TOPIC );
		update_post_meta( $id, Meta::SUMMARY, 'A summary.' );

		return $id;
	}

	/**
	 * The block rendered through `WP_Block` with a post template's context.
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 * @param int|null             $post       The context's post, or none.
	 * @param string               $post_type  The context's post type.
	 */
	private function render( array $attributes, ?int $post, string $post_type = PostType::NAME ): string {
		$parsed  = array(
			'blockName'    => ResourceCardBlock::NAME,
			'attrs'        => $attributes,
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);
		$context = null === $post ? array() : array(
			'postId'   => $post,
			'postType' => $post_type,
		);

		return ( new WP_Block( $parsed, $context ) )->render();
	}
}
