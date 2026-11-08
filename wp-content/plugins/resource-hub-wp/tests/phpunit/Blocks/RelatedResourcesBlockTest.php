<?php
/**
 * The `resource-hub/related-resources` block's registration and render (issue #50; `packages/ui/README.md`, "Block marker").
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\RelatedResourcesBlock;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Block;
use WP_Block_Type_Registry;
use WP_HTML_Tag_Processor;
use WP_REST_Request;
use WP_UnitTestCase;

/**
 * Every render goes through `WP_Block`, as core's renderer and the editor's preview endpoint do, so block
 * supports and the `postId` context behave as they do on the site. The block is registered from `build/`,
 * so the suite needs `pnpm build` first, as CI runs it.
 */
final class RelatedResourcesBlockTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * A type term's ID; every resource gets it, so the one-type rule holds.
	 *
	 * @var int
	 */
	private int $type;

	/**
	 * The topic the block lists.
	 *
	 * @var int
	 */
	private int $topic;

	/**
	 * Creates one type and one topic, under pretty permalinks.
	 *
	 * The links are the contract's permalinks, `/resources/{type}/{slug}/`, which need a permalink
	 * structure. Setting one resets core's rewrite object, which drops the post type's permastructure
	 * and the taxonomy's rewrite tag, so both are registered again, as activation does and as
	 * `PermalinkTest` does.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$this->assertTrue(
			WP_Block_Type_Registry::get_instance()->is_registered( RelatedResourcesBlock::NAME ),
			'The block is not registered: run `pnpm build` so build/related-resources/block.json exists.'
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

		// The tests database's term IDs are not the CMS's, so the type created here is given the webinar's row.
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
	 * Back to plain permalinks, as the other suites expect, and to the build's type-accent table.
	 */
	public function tear_down(): void {
		self::reset_type_accents();
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * The compiled block.json is registered with the callback, the contract's attributes and its stylesheet.
	 */
	public function test_registered_from_build_with_attributes_and_style(): void {
		$type = WP_Block_Type_Registry::get_instance()->get_registered( RelatedResourcesBlock::NAME );

		$this->assertIsCallable( $type->render_callback );
		$this->assertSame( 'integer', $type->attributes['topic']['type'] );
		$this->assertSame( 0, $type->attributes['topic']['default'] );
		$this->assertSame( 'integer', $type->attributes['count']['type'] );
		$this->assertSame( RelatedResourcesBlock::DEFAULT_COUNT, $type->attributes['count']['default'] );
		// No minimum or maximum in the schema: core would replace an out-of-range value with the default
		// before the callback ran, and the contract says clamp (see test_count_is_clamped()).
		$this->assertArrayNotHasKey( 'minimum', $type->attributes['count'] );
		$this->assertArrayNotHasKey( 'maximum', $type->attributes['count'] );
		$this->assertSame( 'string', $type->attributes['heading']['type'] );
		$this->assertSame( '', $type->attributes['heading']['default'] );
		$this->assertSame( array( 'postId' ), $type->uses_context );

		$this->assertCount( 1, $type->style_handles );
		$style = wp_styles()->registered[ $type->style_handles[0] ] ?? null;
		$this->assertNotNull( $style, 'The block style is registered with wp_styles().' );
		$this->assertStringEndsWith( '/build/related-resources/style-index.css', $style->src );

		// The compiled stylesheet is the shared package's tokens and the row, tokens first.
		$css = file_get_contents( dirname( __DIR__, 3 ) . '/build/related-resources/style-index.css' ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local file from the plugin's own build, read by a test, never a remote URL.
		$this->assertStringContainsString( '--rh-color-text:', $css );
		$this->assertStringContainsString( '.rh-card', $css );
		$this->assertStringContainsString( '.rh-card__type', $css, 'card-labels.css, which card.css imports, is inlined too.' );
		$this->assertLessThan( strpos( $css, '.rh-card' ), strpos( $css, '--rh-color-text:' ), 'tokens.css comes first.' );
	}

	/**
	 * No topic chosen, in every form the attribute can take, renders nothing at all.
	 *
	 * @dataProvider no_topic_cases
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 */
	public function test_no_topic_renders_nothing( array $attributes ): void {
		$this->resource( 'one' );

		$this->assertSame( '', $this->render( $attributes, $this->host() ) );
	}

	/**
	 * Cases for test_no_topic_renders_nothing().
	 *
	 * @return array<string, array{0: array<string, mixed>}>
	 */
	public function no_topic_cases(): array {
		return array(
			'no attribute'      => array( array() ),
			'the default, 0'    => array( array( 'topic' => 0 ) ),
			'an empty string'   => array( array( 'topic' => '' ) ),
			'a negative ID'     => array( array( 'topic' => -3 ) ),
			'not a number'      => array( array( 'topic' => 'testing' ) ),
			'a count, no topic' => array( array( 'count' => 5 ) ),
		);
	}

	/**
	 * A stored term that was deleted, or that is not a topic, renders nothing.
	 */
	public function test_deleted_or_foreign_term_renders_nothing(): void {
		$this->resource( 'one' );
		$host = $this->host();

		$this->assertStringContainsString( 'data-topic="testing"', $this->render( array( 'topic' => $this->topic ), $host ) );

		wp_delete_term( $this->topic, Taxonomies::TOPIC );
		$this->assertSame( '', $this->render( array( 'topic' => $this->topic ), $host ) );

		// A type term's ID is not a topic.
		$this->assertSame( '', $this->render( array( 'topic' => $this->type ), $host ) );
	}

	/**
	 * The marker, attribute by attribute, around the heading and the rows' permalinks.
	 */
	public function test_marker_attributes_heading_and_links(): void {
		$older = $this->resource( 'older', array( 'post_date' => '2026-01-01 10:00:00' ) );
		$newer = $this->resource( 'newer', array( 'post_date' => '2026-02-01 10:00:00' ) );
		$host  = $this->host();

		$html = $this->render( array( 'topic' => $this->topic ), $host );

		$this->assertSame(
			array(
				'data-rh-block' => RelatedResourcesBlock::MARKER,
				'data-count'    => '3',
				'data-topic'    => 'testing',
				'data-topic-id' => (string) $this->topic,
				'data-exclude'  => (string) $host,
			),
			$this->marker_attributes( $html )
		);
		$this->assertContains( RelatedResourcesBlock::CLASS_NAME, $this->wrapper_classes( $html ) );
		$this->assertContains( 'wp-block-resource-hub-related-resources', $this->wrapper_classes( $html ), 'get_block_wrapper_attributes() adds the block class.' );
		$this->assertSame( 'More on Testing', $this->heading( $html ) );
		$this->assertSame(
			array(
				get_permalink( $newer ) => 'Resource newer',
				get_permalink( $older ) => 'Resource older',
			),
			$this->links( $html )
		);
		$this->assertStringContainsString( '/resources/webinar/newer/', get_permalink( $newer ), 'The links are the contract\'s permalinks.' );
		$this->assertStringStartsWith( '<div ', $html );
		$this->assertStringEndsWith( '</ul></div>', $html );
	}

	/**
	 * `data-topic` is the term's slug at render time: a renamed topic keeps working and names the new tag.
	 */
	public function test_slug_and_heading_follow_a_rename(): void {
		$this->resource( 'one' );
		$host = $this->host();

		wp_update_term(
			$this->topic,
			Taxonomies::TOPIC,
			array(
				'name' => 'Quality assurance',
				'slug' => 'quality-assurance',
			)
		);

		$html = $this->render( array( 'topic' => $this->topic ), $host );

		$this->assertSame( 'quality-assurance', $this->marker_attributes( $html )['data-topic'] );
		$this->assertSame( (string) $this->topic, $this->marker_attributes( $html )['data-topic-id'] );
		$this->assertSame( 'More on Quality assurance', $this->heading( $html ) );
	}

	/**
	 * `count` is clamped to 1–10 in PHP, in the attribute and in the list; a non-number is the default.
	 *
	 * @dataProvider count_cases
	 *
	 * @param mixed $count    The stored attribute.
	 * @param int   $expected The clamped count.
	 */
	public function test_count_is_clamped( mixed $count, int $expected ): void {
		for ( $i = 1; $i <= 11; $i++ ) {
			$this->resource( "r{$i}", array( 'post_date' => sprintf( '2026-01-%02d 10:00:00', $i ) ) );
		}
		$host = $this->host();

		$attributes = array( 'topic' => $this->topic );
		if ( null !== $count ) {
			$attributes['count'] = $count;
		}
		$html = $this->render( $attributes, $host );

		$this->assertSame( $expected, RelatedResourcesBlock::clamp_count( $count ?? RelatedResourcesBlock::DEFAULT_COUNT ) );
		$this->assertSame( (string) $expected, $this->marker_attributes( $html )['data-count'] );
		$this->assertCount( $expected, $this->links( $html ) );
	}

	/**
	 * Cases for test_count_is_clamped().
	 *
	 * @return array<string, array{0: mixed, 1: int}>
	 */
	public function count_cases(): array {
		return array(
			'absent, the default' => array( null, 3 ),
			'zero'                => array( 0, 1 ),
			'negative'            => array( -4, 1 ),
			'in range'            => array( 5, 5 ),
			'a numeric string'    => array( '7', 7 ),
			'the ceiling'         => array( 10, 10 ),
			'over the ceiling'    => array( 99, 10 ),
			'not a number'        => array( 'many', 3 ),
		);
	}

	/**
	 * The post the block sits in is left out, and the list still holds `count` others, whatever the host's type.
	 */
	public function test_host_post_is_excluded_on_any_post_type(): void {
		$others = array();
		for ( $i = 1; $i <= 3; $i++ ) {
			$others[] = $this->resource( "other{$i}", array( 'post_date' => sprintf( '2026-01-%02d 10:00:00', $i ) ) );
		}
		// The newest resource in the topic is the host, so without the exclusion it would head the list.
		$host = $this->resource( 'host', array( 'post_date' => '2026-03-01 10:00:00' ) );

		$html = $this->render( array( 'topic' => $this->topic ), $host );

		$this->assertSame( (string) $host, $this->marker_attributes( $html )['data-exclude'] );
		$this->assertSame( array_map( 'get_permalink', array_reverse( $others ) ), array_keys( $this->links( $html ) ) );

		// On a page, nothing in the topic is the host, so the newest three, the host resource among them.
		$page = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => 'publish',
			)
		);
		$html = $this->render( array( 'topic' => $this->topic ), $page );

		$this->assertSame( (string) $page, $this->marker_attributes( $html )['data-exclude'] );
		$this->assertSame(
			array( get_permalink( $host ), get_permalink( $others[2] ), get_permalink( $others[1] ) ),
			array_keys( $this->links( $html ) )
		);
	}

	/**
	 * Without a `postId` context and without a global post, `data-exclude` is 0 and nothing is left out.
	 */
	public function test_no_host_post_gives_exclude_zero(): void {
		$one = $this->resource( 'one' );
		unset( $GLOBALS['post'] );
		$this->assertFalse( get_the_ID(), 'No global post.' );

		$html = $this->render( array( 'topic' => $this->topic ), null );

		$this->assertSame( '0', $this->marker_attributes( $html )['data-exclude'] );
		$this->assertSame( array( get_permalink( $one ) ), array_keys( $this->links( $html ) ) );
	}

	/**
	 * Only published resources in the topic: not drafts, pending, private, scheduled or trashed ones, not
	 * resources in another topic, and not another post type carrying the term.
	 */
	public function test_only_published_resources_in_the_topic(): void {
		$published = $this->resource( 'published' );
		foreach ( array( 'draft', 'pending', 'private', 'trash' ) as $status ) {
			$this->resource( $status, array( 'post_status' => $status ) );
		}
		$this->resource(
			'scheduled',
			array(
				'post_status' => 'future',
				'post_date'   => gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS ),
			)
		);
		$other_topic = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$this->resource( 'elsewhere', array(), $other_topic );
		$post = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_set_object_terms( $post, $this->topic, Taxonomies::TOPIC );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( get_permalink( $published ) ), array_keys( $this->links( $html ) ) );
	}

	/**
	 * Newest first by publish date, whatever the order of creation.
	 */
	public function test_newest_first(): void {
		$middle = $this->resource( 'middle', array( 'post_date' => '2026-02-01 10:00:00' ) );
		$newest = $this->resource( 'newest', array( 'post_date' => '2026-03-01 10:00:00' ) );
		$oldest = $this->resource( 'oldest', array( 'post_date' => '2026-01-01 10:00:00' ) );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame(
			array( get_permalink( $newest ), get_permalink( $middle ), get_permalink( $oldest ) ),
			array_keys( $this->links( $html ) )
		);
	}

	/**
	 * A heading given is used as written; empty or blank means "More on {topic}".
	 */
	public function test_heading_attribute(): void {
		$this->resource( 'one' );
		$host = $this->host();

		$this->assertSame(
			'Keep reading',
			$this->heading(
				$this->render(
					array(
						'topic'   => $this->topic,
						'heading' => 'Keep reading',
					),
					$host
				)
			)
		);
		$this->assertSame(
			'More on Testing',
			$this->heading(
				$this->render(
					array(
						'topic'   => $this->topic,
						'heading' => '',
					),
					$host
				)
			)
		);
		$this->assertSame(
			'More on Testing',
			$this->heading(
				$this->render(
					array(
						'topic'   => $this->topic,
						'heading' => "  \n ",
					),
					$host
				)
			)
		);
	}

	/**
	 * Each row is `card.css`'s markup, as the front end's `ResourceCard` renders it at `h3`: the meta line with
	 * the type (its `data-accent` from the type-accent table) and the date, then the body with the linked title, the
	 * summary when there is one and the topics when there are any.
	 */
	public function test_rows_are_card_markup(): void {
		$second_topic = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'Accessibility',
			)
		);
		$full         = $this->resource( 'full', array( 'post_date' => '2026-09-05 10:30:00' ) );
		wp_set_object_terms( $full, array( $this->topic, $second_topic ), Taxonomies::TOPIC );
		update_post_meta( $full, Meta::SUMMARY, 'A short summary.' );
		$bare = $this->resource( 'bare', array( 'post_date' => '2026-01-01 08:00:00' ) );
		$host = $this->host();

		// A listed row always carries the block's topic, so a row with no topics is reached by filtering them away.
		$drop_topics = static fn ( $terms, $post_id, $taxonomy ) => $bare === $post_id && Taxonomies::TOPIC === $taxonomy ? array() : $terms;
		add_filter( 'get_the_terms', $drop_topics, 10, 3 );
		$html        = $this->render( array( 'topic' => $this->topic ), $host );
		remove_filter( 'get_the_terms', $drop_topics, 10 );

		$this->assertStringContainsString(
			'<h2>More on Testing</h2><ul class="rh-card-grid" role="list"><li><article class="rh-card">'
				. '<p class="rh-card__meta"><span class="rh-card__type" data-accent="coral">Webinar</span><time datetime="2026-09-05T10:30:00Z">Sep 5, 2026</time></p>'
				. '<div class="rh-card__body">'
				. '<h3 class="rh-card__title"><a class="rh-card__link" href="' . esc_url( get_permalink( $full ) ) . '">Resource full</a></h3>'
				. '<p class="rh-card__summary">A short summary.</p>'
				. '<ul class="rh-card__topics" aria-label="Topics" role="list"><li class="rh-card__topic">Accessibility</li><li class="rh-card__topic">Testing</li></ul>'
				. '</div></article></li>',
			$html,
			'The row with a summary and topics.'
		);
		$this->assertStringEndsWith(
			'<li><article class="rh-card">'
				. '<p class="rh-card__meta"><span class="rh-card__type" data-accent="coral">Webinar</span><time datetime="2026-01-01T08:00:00Z">Jan 1, 2026</time></p>'
				. '<div class="rh-card__body">'
				. '<h3 class="rh-card__title"><a class="rh-card__link" href="' . esc_url( get_permalink( $bare ) ) . '">Resource bare</a></h3>'
				. '</div></article></li></ul></div>',
			$html,
			'The row with no summary and no topics has neither element.'
		);
		$this->assertSame( 2, substr_count( $html, '<article class="rh-card">' ) );
	}

	/**
	 * A type the table does not know, or one whose slug is not the row's, is marked `neutral`, as the front end
	 * marks it; the attribute is escaped like every other.
	 */
	public function test_type_without_a_row_is_neutral(): void {
		$guide = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Guide',
				'slug'     => 'guide',
			)
		);
		$this->resource( 'known', array( 'post_date' => '2026-03-01 10:00:00' ) );
		$other = $this->resource( 'other', array( 'post_date' => '2026-02-01 10:00:00' ) );
		wp_set_object_terms( $other, array( $guide ), Taxonomies::TYPE );
		$host = $this->host();

		$this->assertSame(
			array( 'coral', 'neutral' ),
			$this->accents( $this->render( array( 'topic' => $this->topic ), $host ) )
		);

		wp_update_term( $this->type, Taxonomies::TYPE, array( 'slug' => 'talk' ) );
		$this->assertSame(
			array( 'neutral', 'neutral' ),
			$this->accents( $this->render( array( 'topic' => $this->topic ), $host ) ),
			'A renamed type no longer matches its row.'
		);
	}

	/**
	 * Each row's `data-accent`, in order.
	 *
	 * @param string $html A render.
	 * @return string[]
	 */
	private function accents( string $html ): array {
		$tags    = new WP_HTML_Tag_Processor( $html );
		$accents = array();

		while ( $tags->next_tag( array( 'class_name' => 'rh-card__type' ) ) ) {
			$accents[] = (string) $tags->get_attribute( 'data-accent' );
		}

		return $accents;
	}

	/**
	 * A resource without exactly one type, which only a PHP caller can publish, gets no row: one with no
	 * type never comes back from the query, and one with two is dropped in PHP. Neither leaves a gap.
	 */
	public function test_resource_without_exactly_one_type_is_dropped(): void {
		$kept    = $this->resource( 'kept', array( 'post_date' => '2026-01-01 10:00:00' ) );
		$untyped = $this->resource( 'untyped', array( 'post_date' => '2026-02-01 10:00:00' ) );
		wp_set_object_terms( $untyped, array(), Taxonomies::TYPE );
		$two_types = $this->resource( 'two-types', array( 'post_date' => '2026-03-01 10:00:00' ) );
		$second    = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Guide',
				'slug'     => 'guide',
			)
		);
		wp_set_object_terms( $two_types, array( $this->type, $second ), Taxonomies::TYPE );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( get_permalink( $kept ) ), array_keys( $this->links( $html ) ) );
		$this->assertSame( 1, substr_count( $html, '<article class="rh-card">' ) );
		$this->assertStringNotContainsString( 'Resource untyped', $html );
		$this->assertStringNotContainsString( 'Resource two-types', $html );
		$this->assertStringContainsString( '<span class="rh-card__type" data-accent="coral">Webinar</span>', $html, 'The row left has its type.' );
	}

	/**
	 * A title that is empty as plain text drops the row, by the front end's test: nothing left once tags,
	 * whitespace, `\p{Z}` and the zero-width characters are gone. The resource after it still gets its row.
	 *
	 * @dataProvider empty_title_cases
	 *
	 * @param string $title The stored title.
	 */
	public function test_resource_with_an_empty_title_is_dropped( string $title ): void {
		$kept = $this->resource( 'kept', array( 'post_date' => '2026-01-01 10:00:00' ) );
		// Core refuses a post with no title, content or excerpt, so the empty-title one has content.
		$this->resource(
			'blank',
			array(
				'post_date'    => '2026-02-01 10:00:00',
				'post_title'   => $title,
				'post_content' => 'Body.',
			)
		);

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( get_permalink( $kept ) ), array_keys( $this->links( $html ) ) );
		$this->assertSame( 1, substr_count( $html, '<article class="rh-card">' ) );
	}

	/**
	 * Cases for test_resource_with_an_empty_title_is_dropped().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function empty_title_cases(): array {
		return array(
			'empty'           => array( '' ),
			'whitespace only' => array( " \t\n " ),
			'&nbsp;'          => array( '&nbsp;' ),
			'&#8203;'         => array( '&#8203;' ),
			'an empty <em>'   => array( '<em></em>' ),
			'a BOM'           => array( "\u{FEFF}" ),
			'a mix of them'   => array( "&nbsp;<em>\u{200B}</em>\u{3000}\u{FEFF}" ),
		);
	}

	/**
	 * A NEL (U+0085) is not whitespace to JavaScript's `\s`, so a title of nothing else is kept, as the front
	 * end keeps it, where PCRE's `\s` under `/u` would have matched it and dropped the row.
	 */
	public function test_nel_only_title_is_kept(): void {
		$id = $this->resource( 'nel', array( 'post_title' => "\u{0085}" ) );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( get_permalink( $id ) => "\u{0085}" ), $this->links( $html ) );
	}

	/**
	 * The link text is the HTML the front end writes for the same title: `plainText()` of `title.rendered`
	 * (tags gone, entities decoded once, `\s` runs collapsed), then escaped as React escapes text, every `&`
	 * included, so an `&amp;` in the text is encoded again.
	 *
	 * @dataProvider title_parity_cases
	 *
	 * @param string $title    The stored title.
	 * @param string $expected The link's inner HTML.
	 */
	public function test_title_html_matches_the_front_end( string $title, string $expected ): void {
		$id = $this->resource( 'parity', array( 'post_title' => $title ) );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( get_permalink( $id ) => $expected ), $this->links( $html ) );
	}

	/**
	 * Cases for test_title_html_matches_the_front_end(): stored title, then the HTML `plainText()` and React's
	 * `renderToStaticMarkup()` give for the `title.rendered` core makes of it. The cases shared with
	 * `apps/web/test/wp-images-cards.test.ts` ("decodes the rendered title…", "decodes escaped markup…") use
	 * its inputs. One byte difference is expected and not chased: React writes `'` as `&#x27;` and
	 * `htmlspecialchars()` as `&#039;`, the same character in the page.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function title_parity_cases(): array {
		return array(
			'an encoded entity stays encoded' => array( 'Tips &amp;amp; tricks', 'Tips &amp;amp; tricks' ),
			'an ampersand'                    => array( 'Tom &amp; Jerry', 'Tom &amp; Jerry' ),
			'NEL between spaces is kept'      => array( "One \u{0085} two", "One \u{0085} two" ),
			'quotes, straight and encoded'    => array( '5&quot; screen &amp; &#039;wide&#039; "straight"', '5&quot; screen &amp; &#039;wide&#039; “straight”' ),
			'markup and runs of whitespace'   => array( "Tom &amp; <em>Jerry</em>&nbsp;at\n  <strong>home</strong>", 'Tom &amp; Jerry at home' ),
			'texturized entities and markup'  => array( 'Alt text &#8217;n&#8217; <em>more</em> &#038; more', 'Alt text ’n’ more &amp; more' ),
			'escaped markup is inert text'    => array( '&lt;img src=x onerror=alert(1)&gt;', '&lt;img src=x onerror=alert(1)&gt;' ),
		);
	}

	/**
	 * The summary is the HTML the front end writes for `meta.summary`: React text, with nothing stripped,
	 * decoded or collapsed, every `&` encoded, so an entity left in the stored text stays literal text. The
	 * `<p>` is left out only for the empty string, the front end's `summary &&`, so `0` keeps it.
	 *
	 * @dataProvider summary_parity_cases
	 *
	 * @param string      $input    The value saved, through the meta's sanitizer.
	 * @param string      $stored   What is stored, the REST API's `meta.summary`.
	 * @param string|null $expected The summary's inner HTML, or null for no summary element.
	 */
	public function test_summary_html_matches_the_front_end( string $input, string $stored, ?string $expected ): void {
		$id = $this->resource( 'summary' );
		update_post_meta( $id, Meta::SUMMARY, $input );
		$this->assertSame( $stored, get_post_meta( $id, Meta::SUMMARY, true ), 'The stored summary.' );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( null === $expected ? array() : array( $expected ), $this->texts( 'p', 'rh-card__summary', $html ) );
	}

	/**
	 * Cases for test_summary_html_matches_the_front_end(): saved value, stored value, then the HTML React's
	 * `renderToStaticMarkup()` gives for `{summary && <p>{summary}</p>}` with the stored value (`ResourceCard`;
	 * `toCard()` passes `meta.summary` through untouched). React writes `'` as `&#x27;`, `htmlspecialchars()`
	 * as `&#039;`.
	 *
	 * @return array<string, array{0: string, 1: string, 2: string|null}>
	 */
	public function summary_parity_cases(): array {
		return array(
			'an encoded &amp; stays encoded'  => array( 'Tips &amp;amp; tricks', 'Tips &amp; tricks', 'Tips &amp;amp; tricks' ),
			'an ampersand'                    => array( 'Tom & Jerry', 'Tom & Jerry', 'Tom &amp; Jerry' ),
			'a named reference is literal'    => array( 'Caf&eacute; au lait', 'Caf&eacute; au lait', 'Caf&amp;eacute; au lait' ),
			'a numeric reference is literal'  => array( 'It&#8217;s here', 'It&#8217;s here', 'It&amp;#8217;s here' ),
			'quotes'                          => array( '5" screen, \'wide\'', '5" screen, \'wide\'', '5&quot; screen, &#039;wide&#039;' ),
			'escaped markup is inert text'    => array( '&lt;img src=x onerror=alert(1)&gt;', '<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;' ),
			'inner whitespace is not touched' => array( "One\n\ntwo   three\u{00A0}four", "One\n\ntwo   three\u{00A0}four", "One\n\ntwo   three\u{00A0}four" ),
			'zero is a summary'               => array( '0', '0', '0' ),
			'empty has no element'            => array( '', '', null ),
			'whitespace is stored empty'      => array( " \n\t ", '', null ),
		);
	}

	/**
	 * The type's name and each topic's name are the HTML the front end writes for them: `plainText()` of the
	 * stored `name` (tags gone, entities decoded once, `\s` runs collapsed, trimmed), then escaped as React
	 * escapes text. A name empty as plain text keeps its element, as the front end keeps it.
	 *
	 * @dataProvider term_name_parity_cases
	 *
	 * @param string $name     The stored name, the REST API's embedded `name`.
	 * @param string $expected The type's and the topic's inner HTML.
	 */
	public function test_term_names_match_the_front_end( string $name, string $expected ): void {
		// Store the name as given, as a PHP caller can; the test case restores the filters.
		remove_all_filters( 'pre_term_name' );
		wp_update_term( $this->type, Taxonomies::TYPE, array( 'name' => $name ) );
		wp_update_term( $this->topic, Taxonomies::TOPIC, array( 'name' => $name ) );
		$this->assertSame( $name, get_term_field( 'name', $this->type, Taxonomies::TYPE, 'raw' ), 'The stored type name.' );
		$this->assertSame( $name, get_term_field( 'name', $this->topic, Taxonomies::TOPIC, 'raw' ), 'The stored topic name.' );
		$this->resource( 'named' );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( $expected ), $this->texts( 'span', 'rh-card__type', $html ), 'The type.' );
		$this->assertSame( array( $expected ), $this->texts( 'li', 'rh-card__topic', $html ), 'The topic.' );
	}

	/**
	 * Cases for test_term_names_match_the_front_end(): stored name, then the HTML `plainText()` and React's
	 * `renderToStaticMarkup()` give for it. Core stores a name with `&` as `&amp;` and its tags stripped, so the
	 * first two read the same under `esc_html()` too; the rest do not.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function term_name_parity_cases(): array {
		return array(
			'an encoded &amp;'                     => array( 'R&amp;D', 'R&amp;D' ),
			'an encoded &amp;amp; stays encoded'   => array( 'Tips &amp;amp; tricks', 'Tips &amp;amp; tricks' ),
			'a named reference is decoded'         => array( 'Caf&eacute;', 'Café' ),
			'a numeric reference is decoded'       => array( 'Q&amp;A &#8212; live', 'Q&amp;A — live' ),
			'&nbsp; runs collapse'                 => array( 'A&nbsp;&nbsp;B', 'A B' ),
			'Unicode spaces collapse and trim'     => array( "\u{3000}A\u{00A0}\u{2003}B\u{FEFF}", 'A B' ),
			'NEL is kept'                          => array( "A \u{0085} B", "A \u{0085} B" ),
			'markup is stripped'                   => array( '<em>Deep</em> dive', 'Deep dive' ),
			'escaped markup is inert text'         => array( '&lt;em&gt;', '&lt;em&gt;' ),
			'quotes'                               => array( '5&quot; \'wide\'', '5&quot; &#039;wide&#039;' ),
			'empty as plain text keeps an element' => array( '&nbsp;', '' ),
		);
	}

	/**
	 * Topics are deduplicated after plain text, as the front end puts its `plainText()` labels in a `Set`: two
	 * terms named `A B` and `A&nbsp;B` are one topic on both sites.
	 */
	public function test_topics_are_deduplicated_as_plain_text(): void {
		wp_update_term( $this->topic, Taxonomies::TOPIC, array( 'name' => 'A B' ) );
		$twin = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TOPIC,
				'name'     => 'A&nbsp;B',
			)
		);
		$this->assertSame( 'A&nbsp;B', get_term_field( 'name', $twin, Taxonomies::TOPIC, 'raw' ) );
		$id = $this->resource( 'twins' );
		wp_set_object_terms( $id, array( $this->topic, $twin ), Taxonomies::TOPIC );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array( 'A B' ), $this->texts( 'li', 'rh-card__topic', $html ) );
	}

	/**
	 * The over-fetch keeps `count` filled when some of the newest are dropped.
	 */
	public function test_count_stays_filled_when_the_newest_are_dropped(): void {
		$valid = $this->valid_resources( 4 );
		$this->dropped_resources( 3, '2026-06' );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( '3', $this->marker_attributes( $html )['data-count'] );
		$this->assertSame( array_map( 'get_permalink', array_slice( $valid, 0, 3 ) ), array_keys( $this->links( $html ) ) );
	}

	/**
	 * With the host the newest and dropped rows behind it, `count` is still filled.
	 */
	public function test_host_and_dropped_rows_still_fill_count(): void {
		$valid = $this->valid_resources( 4 );
		$this->dropped_resources( 2, '2026-06' );
		$host = $this->resource( 'host', array( 'post_date' => '2026-09-01 10:00:00' ) );

		$html = $this->render( array( 'topic' => $this->topic ), $host );

		$this->assertSame( array_map( 'get_permalink', array_slice( $valid, 0, 3 ) ), array_keys( $this->links( $html ) ) );
	}

	/**
	 * More than `SLACK` dropped among the newest gives a shorter list, not an error and not a second query.
	 */
	public function test_more_than_slack_dropped_gives_a_shorter_list(): void {
		$valid = $this->valid_resources( 3 );
		// The query fetches count + 1 + SLACK = 9 rows: these 7, then the two newest valid ones.
		$this->dropped_resources( RelatedResourcesBlock::SLACK + 2, '2026-06' );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( '3', $this->marker_attributes( $html )['data-count'] );
		$this->assertSame( array_map( 'get_permalink', array_slice( $valid, 0, 2 ) ), array_keys( $this->links( $html ) ) );
		$this->assertStringEndsWith( '</ul></div>', $html );
	}

	/**
	 * Typeless resources never come back from the query (the `EXISTS` clause on `resource_type`), so they take
	 * no slack: with more than `SLACK` of them the newest, `count` is still filled from the older valid ones.
	 * Dropped in PHP alone, the 9 rows fetched would be these 7 and the two newest valid ones.
	 */
	public function test_typeless_resources_take_no_slack(): void {
		$valid = $this->valid_resources( 3 );
		for ( $i = 1; $i <= RelatedResourcesBlock::SLACK + 2; $i++ ) {
			$id = $this->resource( "typeless{$i}", array( 'post_date' => sprintf( '2026-06-%02d 10:00:00', $i ) ) );
			wp_set_object_terms( $id, array(), Taxonomies::TYPE );
		}

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( array_map( 'get_permalink', $valid ), array_keys( $this->links( $html ) ) );
	}

	/**
	 * When every resource in the topic is dropped, the block renders the one-line note, as for an empty topic.
	 */
	public function test_every_row_dropped_renders_the_note(): void {
		$this->dropped_resources( 4, '2026-06' );

		$html = $this->render( array( 'topic' => $this->topic ), $this->host() );

		$this->assertSame( 'More on Testing', $this->heading( $html ) );
		$this->assertStringNotContainsString( '<ul', $html );
		$this->assertStringEndsWith( '</h2><p>No other resources in this topic yet.</p></div>', $html );
	}

	/**
	 * The rows' terms and meta are primed by the query, one query each, so a row adds no query of its own.
	 *
	 * Every row has its own type and its own second topic, besides the block's, so a term lookup the
	 * priming missed would cost a query per row rather than once per render; three rows and six then
	 * costing the same, from cold post caches, shows no row reads a term, its meta or its permalink with
	 * a query of its own.
	 */
	public function test_rows_add_no_queries_of_their_own(): void {
		$ids = array();
		for ( $i = 1; $i <= 6; $i++ ) {
			$id    = $this->resource( "r{$i}", array( 'post_date' => sprintf( '2026-01-%02d 10:00:00', $i ) ) );
			$ids[] = $id;
			update_post_meta( $id, Meta::SUMMARY, "Summary {$i}." );
			wp_set_object_terms(
				$id,
				self::factory()->term->create(
					array(
						'taxonomy' => Taxonomies::TYPE,
						'name'     => "Type {$i}",
						'slug'     => "type-{$i}",
					)
				),
				Taxonomies::TYPE
			);
			$own_topic = self::factory()->term->create(
				array(
					'taxonomy' => Taxonomies::TOPIC,
					'name'     => "Topic {$i}",
				)
			);
			wp_set_object_terms( $id, array( $this->topic, $own_topic ), Taxonomies::TOPIC );
		}
		$host = $this->host();

		$queries = function ( int $count ) use ( $ids, $host ): int {
			array_map( 'clean_post_cache', $ids );
			$before = get_num_queries();
			$html   = $this->render(
				array(
					'topic' => $this->topic,
					'count' => $count,
				),
				$host
			);
			$this->assertSame( $count, substr_count( $html, '<article class="rh-card">' ) );
			$this->assertSame( $count, substr_count( $html, '<li class="rh-card__topic">Topic ' ), 'Each row has its own second topic.' );

			return get_num_queries() - $before;
		};

		// The first render also loads what every render shares (the topic's term object), so it is not counted.
		$queries( 1 );
		$this->assertSame( $queries( 3 ), $queries( 6 ), 'Six rows cost the same queries as three.' );
	}

	/**
	 * A topic with no other published resource still renders the marker and the heading, with a note in place of the list.
	 */
	public function test_empty_topic_renders_marker_without_a_list(): void {
		$host = $this->resource( 'host' );

		$html = $this->render( array( 'topic' => $this->topic ), $host );

		$this->assertSame( (string) $host, $this->marker_attributes( $html )['data-exclude'] );
		$this->assertSame( 'More on Testing', $this->heading( $html ) );
		$this->assertStringNotContainsString( '<ul', $html );
		$this->assertStringEndsWith( '</h2><p>No other resources in this topic yet.</p></div>', $html );
	}

	/**
	 * Every text node and attribute is escaped: a heading and a term name with markup and quotes, and a
	 * title whose markup is stripped to text before it is escaped.
	 */
	public function test_output_is_escaped(): void {
		// Core's save filters strip what kses forbids (`<script>`) and keep `<em>`, so the stored title holds markup.
		$id = $this->resource( 'tricky', array( 'post_title' => 'Tom & Jerry <em>at home</em> <script>alert(1)</script>' ) );
		$this->assertStringContainsString( '<em>at home</em>', get_post_field( 'post_title', $id, 'raw' ) );
		// A term's name goes through `sanitize_text_field`, which strips every tag, and kses, which encodes `&`.
		wp_update_term( $this->topic, Taxonomies::TOPIC, array( 'name' => 'R&D "quoted" <em>' ) );
		$this->assertSame( 'R&amp;D "quoted"', get_term_field( 'name', $this->topic, Taxonomies::TOPIC, 'raw' ) );
		$host = $this->host();

		$html = $this->render(
			array(
				'topic'   => $this->topic,
				'heading' => '<b>Bold</b> & "quotes" \'apostrophe\'',
			),
			$host
		);

		$this->assertStringNotContainsString( '<script', $html );
		$this->assertStringNotContainsString( '<b>', $html );
		$this->assertStringNotContainsString( '<em>', $html );
		$this->assertStringContainsString( '<h2>&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quotes&quot; &#039;apostrophe&#039;</h2>', $html );
		// The title's tags are stripped, as the front end's plain text drops them, and what is left is escaped.
		$this->assertStringContainsString( '>Tom &amp; Jerry at home alert(1)</a>', $html );
		$this->assertStringNotContainsString( '&lt;em&gt;', $html );
		$this->assertSame( array( get_permalink( $id ) ), array_keys( $this->links( $html ) ) );

		// The default heading carries the term's name, which core stores with `&` already encoded; not encoded twice.
		$html = $this->render( array( 'topic' => $this->topic ), $host );
		$this->assertStringContainsString( '<h2>More on R&amp;D &quot;quoted&quot;</h2>', $html );
		$this->assertStringNotContainsString( '&amp;amp;', $html );
	}

	/**
	 * Through `do_blocks()` on a post's content, the host comes from the global post, as on the CMS's own pages.
	 */
	public function test_do_blocks_takes_the_host_from_the_global_post(): void {
		$one  = $this->resource( 'one' );
		$host = $this->resource( 'host' );
		wp_update_post(
			array(
				'ID'           => $host,
				'post_content' => sprintf( '<!-- wp:resource-hub/related-resources {"topic":%d,"count":2} /-->', $this->topic ),
			)
		);

		$GLOBALS['post'] = get_post( $host ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- do_blocks() reads the host from the global post, as on a CMS page inside the loop.
		$html            = do_blocks( get_post_field( 'post_content', $host ) );
		unset( $GLOBALS['post'] );

		$this->assertSame( (string) $host, $this->marker_attributes( $html )['data-exclude'] );
		$this->assertSame( '2', $this->marker_attributes( $html )['data-count'] );
		$this->assertSame( array( get_permalink( $one ) ), array_keys( $this->links( $html ) ) );
	}

	/**
	 * The editor's preview (`/wp/v2/block-renderer`) renders with the post being edited as the host, and a
	 * `count` outside the range is clamped there too, not rejected.
	 */
	public function test_editor_preview_endpoint(): void {
		$one  = $this->resource( 'one' );
		$host = $this->resource( 'host' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$request = new WP_REST_Request( 'GET', '/wp/v2/block-renderer/' . RelatedResourcesBlock::NAME );
		$request->set_param( 'context', 'edit' );
		$request->set_param( 'post_id', $host );
		$request->set_param( 'attributes', array( 'topic' => $this->topic ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$html = $response->get_data()['rendered'];
		$this->assertSame( (string) $host, $this->marker_attributes( $html )['data-exclude'] );
		$this->assertSame( array( get_permalink( $one ) ), array_keys( $this->links( $html ) ) );

		$request->set_param(
			'attributes',
			array(
				'topic' => $this->topic,
				'count' => 11,
			)
		);
		$response = rest_get_server()->dispatch( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( '10', $this->marker_attributes( $response->get_data()['rendered'] )['data-count'] );
	}

	/**
	 * Creates a published resource in the topic, with the type.
	 *
	 * @param string               $slug  Post slug; the title is "Resource {slug}" unless given.
	 * @param array<string, mixed> $args  Overrides for the factory.
	 * @param int|null             $topic The topic term, or the suite's topic.
	 */
	private function resource( string $slug, array $args = array(), ?int $topic = null ): int {
		$id = self::factory()->post->create(
			array_merge(
				array(
					'post_type'   => PostType::NAME,
					'post_status' => 'publish',
					'post_name'   => $slug,
					'post_title'  => "Resource {$slug}",
				),
				$args
			)
		);
		wp_set_object_terms( $id, $this->type, Taxonomies::TYPE );
		wp_set_object_terms( $id, $topic ?? $this->topic, Taxonomies::TOPIC );

		return $id;
	}

	/**
	 * Valid resources dated in January, one a day; returned newest first, as the block lists them.
	 *
	 * @param int $n How many.
	 * @return int[]
	 */
	private function valid_resources( int $n ): array {
		$ids = array();
		for ( $i = 1; $i <= $n; $i++ ) {
			$ids[] = $this->resource( "valid{$i}", array( 'post_date' => sprintf( '2026-01-%02d 10:00:00', $i ) ) );
		}

		return array_reverse( $ids );
	}

	/**
	 * Resources that get no row, alternating an empty title and two types, dated one a day in the month given.
	 *
	 * @param int    $n     How many.
	 * @param string $month The month, `YYYY-MM`, later than the valid ones so they head the query.
	 */
	private function dropped_resources( int $n, string $month ): void {
		$second = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		for ( $i = 1; $i <= $n; $i++ ) {
			$args = array( 'post_date' => sprintf( '%s-%02d 10:00:00', $month, $i ) );
			if ( 1 === $i % 2 ) {
				$args['post_title']   = '';
				$args['post_content'] = 'Body.';
			}
			$id = $this->resource( "dropped{$i}", $args );
			if ( 0 === $i % 2 ) {
				wp_set_object_terms( $id, array( $this->type, $second ), Taxonomies::TYPE );
			}
		}
	}

	/**
	 * A published post of another type to host the block.
	 */
	private function host(): int {
		return self::factory()->post->create( array( 'post_status' => 'publish' ) );
	}

	/**
	 * Renders the block as core does: through `WP_Block`, with the host as the `postId` context.
	 *
	 * @param array<string, mixed> $attributes The block's attributes.
	 * @param int|null             $host       The host post, or null for no context.
	 */
	private function render( array $attributes, ?int $host ): string {
		$parsed  = array(
			'blockName'    => RelatedResourcesBlock::NAME,
			'attrs'        => $attributes,
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);
		$context = null === $host ? array() : array( 'postId' => $host );

		return ( new WP_Block( $parsed, $context ) )->render();
	}

	/**
	 * The wrapper's `data-*` attributes.
	 *
	 * @param string $html The render.
	 * @return array<string, string>
	 */
	private function marker_attributes( string $html ): array {
		$processor = new WP_HTML_Tag_Processor( $html );
		$this->assertTrue( $processor->next_tag( 'div' ), 'The render starts with the wrapper.' );

		$attributes = array();
		foreach ( array( 'data-rh-block', 'data-count', 'data-topic', 'data-topic-id', 'data-exclude' ) as $name ) {
			$attributes[ $name ] = $processor->get_attribute( $name );
		}

		return $attributes;
	}

	/**
	 * The wrapper's classes.
	 *
	 * @param string $html The render.
	 * @return string[]
	 */
	private function wrapper_classes( string $html ): array {
		$processor = new WP_HTML_Tag_Processor( $html );
		$processor->next_tag( 'div' );

		return iterator_to_array( $processor->class_list(), false );
	}

	/**
	 * The `<h2>`'s text, as written in the HTML (entities included).
	 *
	 * @param string $html The render.
	 */
	private function heading( string $html ): string {
		$this->assertSame( 1, preg_match( '#<h2>(.*?)</h2>#s', $html, $match ), 'The render has one heading.' );

		return $match[1];
	}

	/**
	 * The inner HTML of every element with this tag and exactly this class (other attributes may follow it), in order.
	 *
	 * @param string $tag       The tag name.
	 * @param string $class_att The class attribute.
	 * @param string $html      The render.
	 * @return string[]
	 */
	private function texts( string $tag, string $class_att, string $html ): array {
		preg_match_all( '#<' . $tag . ' class="' . preg_quote( $class_att, '#' ) . '"(?: [^>]*)?>(.*?)</' . $tag . '>#s', $html, $matches );

		return $matches[1];
	}

	/**
	 * The rows' title links: permalink to title, in order.
	 *
	 * @param string $html The render.
	 * @return array<string, string>
	 */
	private function links( string $html ): array {
		preg_match_all( '#<h3 class="rh-card__title"><a class="rh-card__link" href="([^"]*)">(.*?)</a></h3>#s', $html, $matches, PREG_SET_ORDER );

		$links = array();
		foreach ( $matches as $match ) {
			$links[ html_entity_decode( $match[1], ENT_QUOTES ) ] = $match[2];
		}

		return $links;
	}
}
