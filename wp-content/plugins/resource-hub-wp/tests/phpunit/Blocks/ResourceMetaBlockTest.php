<?php
/**
 * The `resource-hub/resource-meta` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\ResourceMetaBlock;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Block;
use WP_Block_Type_Registry;
use WP_REST_Request;
use WP_UnitTestCase;

/**
 * The markup itself is `MarkupParityTest`'s, against the contract's fixture; this holds the block's own
 * rules: which post it renders, its links, its topics and its registration.
 */
final class ResourceMetaBlockTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * A type term's ID.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * One type, under pretty permalinks.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$this->assertTrue(
			WP_Block_Type_Registry::get_instance()->is_registered( ResourceMetaBlock::NAME ),
			'The block is not registered: run `pnpm build` so build/resource-meta/block.json exists.'
		);

		$this->type = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Case study',
				'slug'     => 'case-study',
			)
		);
		self::use_type_accents( array() );
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
	 * The compiled block.json: the callback, the context, no wrapper supports, the tokens and the labels' stylesheet.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( ResourceMetaBlock::NAME );

		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'postId', 'postType' ), $type->uses_context );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );

		$this->assertCount( 2, $type->style_handles );
		$this->assertSame( SharedTokens::HANDLE, $type->style_handles[0] );
		$style = wp_styles()->registered[ $type->style_handles[1] ] ?? null;
		$this->assertNotNull( $style );
		$this->assertStringEndsWith( '/build/resource-meta/style-index.css', $style->src );

		$css = file_get_contents( dirname( __DIR__, 3 ) . '/build/resource-meta/style-index.css' ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local file from the plugin's own build, read by a test, never a remote URL.
		$this->assertStringNotContainsString( '--rh-color-text:', $css, 'The tokens come from the shared handle, never inlined.' );
		$this->assertStringContainsString( '.rh-card__type', $css, 'card-labels.css: the mark and the topic labels.' );
		$this->assertStringNotContainsString( '.rh-card__body', $css, 'None of the row\'s layout, as on the front end.' );
	}

	/**
	 * The type links to its listing and each topic to its, the front end's paths on the CMS's origin, with the
	 * mark outside the type's link and the neutral mark for a type the table does not know.
	 */
	public function test_links_the_type_and_topics_to_their_listings(): void {
		$alpha = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Alpha',
				'slug'     => 'alpha',
			)
		);
		$beta  = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Beta',
				'slug'     => 'beta',
			)
		);
		$id    = $this->resource( array( $beta, $alpha ) );
		$html  = $this->render( $id );

		$this->assertSame(
			'<div class="rh-resource__meta">'
			. '<span class="rh-card__type" data-accent="neutral"><a class="rh-resource__type" href="' . home_url( '/resources/case-study/' ) . '">Case study</a></span>'
			. '<time datetime="2026-11-01T09:30:00Z">Nov 1, 2026</time>'
			. '<ul class="rh-card__topics" aria-label="Topics" role="list">'
			. '<li class="rh-card__topic"><a class="rh-resource__topic" href="' . home_url( '/resources/topic/alpha/' ) . '">Alpha</a></li>'
			. '<li class="rh-card__topic"><a class="rh-resource__topic" href="' . home_url( '/resources/topic/beta/' ) . '">Beta</a></li>'
			. '</ul></div>',
			$html
		);
	}

	/**
	 * No topics, no list; two topics with the same plain-text name are both linked, as the front end's
	 * `resourceTopics()` dedupes by slug, not by name.
	 */
	public function test_topics_list(): void {
		$this->assertStringNotContainsString( '<ul', $this->render( $this->resource( array() ) ) );

		$one  = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'A&nbsp;B',
				'slug'     => 'a-b-1',
			)
		);
		$two  = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'A B',
				'slug'     => 'a-b-2',
			)
		);
		$html = $this->render( $this->resource( array( $one, $two ) ) );

		$this->assertSame( 2, substr_count( $html, '>A B</a></li>' ) );
		$this->assertStringContainsString( '/resources/topic/a-b-1/', $html );
		$this->assertStringContainsString( '/resources/topic/a-b-2/', $html );
	}

	/**
	 * Anything but a published resource with exactly one type renders nothing.
	 */
	public function test_renders_nothing_without_a_published_resource(): void {
		$this->assertSame( '', $this->render( null ), 'No context.' );
		$this->assertSame( '', $this->render( self::factory()->post->create() ), 'A post.' );

		foreach ( array( 'draft', 'pending', 'private', 'future' ) as $status ) {
			// A future date, or core publishes a `future` post at once.
			$args = array(
				'post_status'   => $status,
				'post_date_gmt' => '2099-01-01 00:00:00',
			);
			$this->assertSame( '', $this->render( $this->resource( array(), $args ) ), $status );
		}

		$untyped = $this->resource( array() );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$this->assertSame( '', $this->render( $untyped ), 'No type.' );
	}

	/**
	 * In a single template, `do_blocks()` gives the block the global post as its context.
	 */
	public function test_renders_the_global_post(): void {
		$GLOBALS['post'] = get_post( $this->resource( array() ) ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The loop's global post, which a single template sets.

		$this->assertStringStartsWith( '<div class="rh-resource__meta">', do_blocks( '<!-- wp:resource-hub/resource-meta /-->' ) );
	}

	/**
	 * The editor's preview endpoint renders the meta line of the `post_id` the editor sends.
	 */
	public function test_editor_preview_renders_the_post_it_is_sent(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$request = new WP_REST_Request( 'GET', '/wp/v2/block-renderer/' . ResourceMetaBlock::NAME );
		$request->set_query_params(
			array(
				'context' => 'edit',
				'post_id' => $this->resource( array() ),
			)
		);
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertStringStartsWith( '<div class="rh-resource__meta">', $response->get_data()['rendered'] );
	}

	/**
	 * A resource of the type, with these topics, published on 2026-11-01 at 09:30 UTC.
	 *
	 * @param int[]                $topics Topic term IDs.
	 * @param array<string, mixed> $args   More `wp_insert_post()` arguments.
	 */
	private function resource( array $topics, array $args = array() ): int {
		$id = self::factory()->post->create(
			array_merge(
				array(
					'post_type'     => PostType::NAME,
					'post_status'   => 'publish',
					'post_title'    => 'A resource',
					'post_date_gmt' => '2026-11-01 09:30:00',
				),
				$args
			)
		);
		wp_set_object_terms( $id, array( $this->type ), Taxonomies::TYPE );
		wp_set_object_terms( $id, $topics, Taxonomies::TOPIC );

		return $id;
	}

	/**
	 * The block rendered through `WP_Block` with the post as its context.
	 *
	 * @param int|null $post The context's post, or none.
	 */
	private function render( ?int $post ): string {
		$parsed = array(
			'blockName'    => ResourceMetaBlock::NAME,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);

		return ( new WP_Block(
			$parsed,
			null === $post ? array() : array(
				'postId'   => $post,
				'postType' => get_post_type( $post ),
			)
		) )->render();
	}
}
