<?php
/**
 * The `resource-hub/resource-summary` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\ResourceSummaryBlock;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Block;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The escaping is `MarkupParityTest`'s, against the contract's `{case}.summary.html`; this holds the block's
 * own rules: which post it renders, the whitespace rule, and its registration.
 */
final class ResourceSummaryBlockTest extends WP_UnitTestCase {
	/**
	 * A type term's ID.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * One type.
	 */
	public function set_up(): void {
		parent::set_up();
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$this->assertTrue(
			WP_Block_Type_Registry::get_instance()->is_registered( ResourceSummaryBlock::NAME ),
			'The block is not registered: run `pnpm build` so build/resource-summary/block.json exists.'
		);

		$this->type = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
	}

	/**
	 * The compiled block.json: the callback, the context, no attributes, no wrapper supports and no stylesheet.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( ResourceSummaryBlock::NAME );

		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'postId', 'postType' ), $type->uses_context );
		$this->assertArrayNotHasKey( 'attributes', wp_json_file_decode( dirname( __DIR__, 3 ) . '/build/resource-summary/block.json', array( 'associative' => true ) ) );
		$this->assertFalse( $type->supports['className'] );
		$this->assertFalse( $type->supports['customClassName'] );
		$this->assertSame( array(), $type->style_handles, 'The paragraph is styled by the theme\'s resource.css.' );
	}

	/**
	 * The summary as the lead paragraph, with every run of whitespace, no-break spaces included, collapsed
	 * to one space and the ends trimmed, as the front end's `description` is; a stored `0` still renders.
	 */
	public function test_renders_the_collapsed_summary(): void {
		$this->assertSame(
			'<p class="rh-resource__summary">Tags &amp; purges: what &quot;stale&quot; means.</p>',
			$this->render( $this->resource( "  Tags &\u{a0}\u{a0}purges:\n what \"stale\" means.\t" ) )
		);
		$this->assertSame( '<p class="rh-resource__summary">0</p>', $this->render( $this->resource( '0' ) ) );
	}

	/**
	 * An empty summary, or one of whitespace alone, renders nothing: the front end shows no lead then.
	 */
	public function test_renders_nothing_for_an_empty_summary(): void {
		$this->assertSame( '', $this->render( $this->resource( '' ) ) );
		$this->assertSame( '', $this->render( $this->resource( " \u{a0}\n\t" ) ), 'Whitespace and a no-break space alone.' );
		$this->assertSame( "<p class=\"rh-resource__summary\">\u{200b}</p>", $this->render( $this->resource( "\u{200b}" ) ), 'A zero-width space is not whitespace to the front end\'s collapse either.' );
	}

	/**
	 * Anything but a published resource with exactly one type renders nothing, as the meta block.
	 */
	public function test_renders_nothing_without_a_published_typed_resource(): void {
		$this->assertSame( '', $this->render( null ), 'No context.' );
		$this->assertSame( '', $this->render( self::factory()->post->create() ), 'A post.' );
		$this->assertSame( '', $this->render( $this->resource( 'A summary.', array( 'post_status' => 'draft' ) ) ), 'A draft.' );

		$untyped = $this->resource( 'A summary.' );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$this->assertSame( '', $this->render( $untyped ), 'No type.' );

		$this->assertSame( '', $this->render( $this->resource( 'A summary.' ), 'post' ), 'A postType context that is not resource.' );
	}

	/**
	 * In a single template, `do_blocks()` gives the block the global post as its context.
	 */
	public function test_renders_the_global_post(): void {
		$GLOBALS['post'] = get_post( $this->resource( 'A summary.' ) ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- The loop's global post, which a single template sets.
		$html            = do_blocks( '<!-- wp:resource-hub/resource-summary /-->' );
		unset( $GLOBALS['post'] );

		$this->assertSame( '<p class="rh-resource__summary">A summary.</p>', $html );
	}

	/**
	 * A published resource of the type with this stored summary.
	 *
	 * @param string               $summary The stored `summary`, as `MetaRules::sanitize_summary()` would keep it.
	 * @param array<string, mixed> $args    More `wp_insert_post()` arguments.
	 */
	private function resource( string $summary, array $args = array() ): int {
		$id = self::factory()->post->create(
			array_merge(
				array(
					'post_type'   => PostType::NAME,
					'post_status' => 'publish',
				),
				$args
			)
		);
		wp_set_object_terms( $id, array( $this->type ), Taxonomies::TYPE );
		update_post_meta( $id, Meta::SUMMARY, wp_slash( $summary ) );

		return $id;
	}

	/**
	 * The block rendered through `WP_Block` with the post as its context.
	 *
	 * @param int|null    $post      The context's post, or none.
	 * @param string|null $post_type The context's post type; the post's own when null.
	 */
	private function render( ?int $post, ?string $post_type = null ): string {
		$parsed = array(
			'blockName'    => ResourceSummaryBlock::NAME,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);

		return ( new WP_Block(
			$parsed,
			null === $post ? array() : array(
				'postId'   => $post,
				'postType' => $post_type ?? get_post_type( $post ),
			)
		) )->render();
	}
}
