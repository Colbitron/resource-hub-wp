<?php
/**
 * The `resource-hub/page-card` block's registration and render.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\PageCardBlock;
use ResourceHub\Blocks\ResourceCardMarkup;
use ResourceHub\Blocks\SharedCard;
use ResourceHub\Blocks\SharedTokens;
use ResourceHub\ContentModel\PostType;
use WP_Block;
use WP_Block_Type_Registry;
use WP_UnitTestCase;

/**
 * The markup against the contract's fixture is `MarkupParityTest`'s; this holds the block's own rules: which
 * post it renders, the title's fallback and level, the excerpt, and the registration.
 */
final class PageCardBlockTest extends WP_UnitTestCase {
	/**
	 * Pretty permalinks, so a page's link is its path; an administrator, whose titles kses leaves alone.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	/**
	 * Back to plain permalinks.
	 */
	public function tear_down(): void {
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * The compiled block.json: the callback, the post-template ancestor, the context, no wrapper supports and
	 * the two shared handles.
	 */
	public function test_registered_from_build(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( PageCardBlock::NAME );

		$this->assertNotNull( $type, 'The block is not registered: run `pnpm build` so build/page-card/block.json exists.' );
		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( array( 'core/post-template' ), $type->ancestor );
		$this->assertSame( array( 'postId', 'postType' ), $type->uses_context );
		$this->assertFalse( $type->supports['className'] );
		$this->assertSame( array( SharedTokens::HANDLE, SharedCard::HANDLE ), $type->style_handles );
		$this->assertSame( 2, $type->attributes['level']['default'] );
	}

	/**
	 * A published page is the row: the label, the title linked to its path, the excerpt as the summary.
	 */
	public function test_renders_a_published_page(): void {
		$page = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_title'   => 'About & us',
				'post_name'    => 'about',
				'post_excerpt' => 'Who we are.',
			)
		);

		$this->assertSame(
			'<article class="rh-card"><p class="rh-card__meta"><span class="rh-card__kind">Page</span></p><div class="rh-card__body"><h2 class="rh-card__title"><a class="rh-card__link" href="' . home_url( '/about/' ) . '">About &amp; us</a></h2><p class="rh-card__summary">Who we are.</p></div></article>',
			$this->render( $page )
		);
	}

	/**
	 * An empty title is "Untitled page", an empty excerpt is the trimmed body, a body with nothing gives no summary, and
	 * the level is clamped.
	 */
	public function test_title_fallback_excerpt_and_level(): void {
		$page = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_title'   => '',
				'post_content' => '<!-- wp:paragraph --><p>Some body text.</p><!-- /wp:paragraph -->',
			)
		);
		// The factory fills an empty excerpt with a generated one.
		wp_update_post(
			array(
				'ID'           => $page,
				'post_excerpt' => '',
			)
		);
		$html = $this->render( $page, array( 'level' => 3 ) );
		$this->assertStringContainsString( '<h3 class="rh-card__title"><a class="rh-card__link" href="' . get_permalink( $page ) . '">' . ResourceCardMarkup::UNTITLED_PAGE . '</a></h3>', $html );
		$this->assertStringContainsString( '<p class="rh-card__summary">Some body text.</p>', $html );

		$bare = self::factory()->post->create(
			array(
				'post_type'    => 'page',
				'post_title'   => 'Bare',
				'post_content' => '',
			)
		);
		wp_update_post(
			array(
				'ID'           => $bare,
				'post_excerpt' => '',
			)
		);
		$this->assertStringNotContainsString( 'rh-card__summary', $this->render( $bare ) );

		$this->assertStringContainsString( '<h4 class="rh-card__title">', $this->render( $page, array( 'level' => 9 ) ) );
		$this->assertStringContainsString( '<h2 class="rh-card__title">', $this->render( $page, array( 'level' => 'x' ) ) );
	}

	/**
	 * Nothing for a draft or private page, a resource, a post, or a context naming another type.
	 */
	public function test_renders_nothing_for_other_posts(): void {
		$draft    = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'draft',
			)
		);
		$private  = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'private',
			)
		);
		$resource = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		$post     = self::factory()->post->create();
		$page     = self::factory()->post->create( array( 'post_type' => 'page' ) );

		$this->assertSame( '', $this->render( $draft ) );
		$this->assertSame( '', $this->render( $private ) );
		$this->assertSame( '', $this->render( $resource, array(), PostType::NAME ) );
		$this->assertSame( '', $this->render( $post, array(), 'post' ) );
		$this->assertSame( '', $this->render( $page, array(), PostType::NAME ), 'A context naming another type settles it.' );
		$this->assertSame( '', $this->render( 0 ) );
	}

	/**
	 * The block rendered through `WP_Block` with a post template's context.
	 *
	 * @param int                  $post       The post.
	 * @param array<string, mixed> $attributes The block's attributes.
	 * @param string               $type       The context's `postType`.
	 */
	private function render( int $post, array $attributes = array(), string $type = 'page' ): string {
		$parsed = array(
			'blockName'    => PageCardBlock::NAME,
			'attrs'        => $attributes,
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);

		return ( new WP_Block(
			$parsed,
			array(
				'postId'   => $post,
				'postType' => $type,
			)
		) )->render();
	}
}
