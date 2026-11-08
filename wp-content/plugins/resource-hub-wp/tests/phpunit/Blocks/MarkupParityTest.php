<?php
/**
 * The plugin's half of the contract's markup fixtures (`packages/ui/README.md`, "Markup fixtures").
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\ResourceCardBlock;
use ResourceHub\Blocks\ResourceMetaBlock;
use ResourceHub\Blocks\TypeAccents;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\MetaRules;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_Block;
use WP_Term;
use WP_UnitTestCase;

/**
 * The sample resource in `packages/ui/fixtures/markup/resource.json`, stored with core's functions, renders
 * through the `resource-card` and `resource-meta` blocks exactly as `resource-card.html` and
 * `resource-meta.html` say, which is what the front end's `ResourceCard` and `ResourceArticle` render from
 * the same sample (`apps/web/test/markup-parity.test.tsx`). So a change to either side's markup fails one
 * of the two tests until the fixture, and the other side, follow.
 *
 * The sample is in the REST API's forms, so this test first proves that storing it gives those forms
 * back (the rendered title, the stored term names, the stored summary), or the comparison would test a
 * resource the front end never receives. The type's mark is the table's row for the sample's type ID: the
 * tests database gives the term another ID, so that row is mapped onto it.
 *
 * The comparison normalises what the HTML parser ignores, as the front end's test does: whitespace holding
 * a line break between two tags (the fixtures' indentation), and the case of attribute names (React writes
 * `dateTime`). And one thing the contract says differs: links here are absolute, `get_permalink()` and
 * `home_url()`, where the front end's are root-relative, since it strips the CMS's origin from every link
 * and the paths are the same on both sites (`packages/ui/README.md`, "Public URL shape"), so the CMS's
 * origin is removed from each `href` before comparing. Every other byte counts.
 */
final class MarkupParityTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * The sample resource, decoded.
	 *
	 * @var array<string, mixed>
	 */
	private array $sample;

	/**
	 * The sample, stored.
	 *
	 * @var int
	 */
	private int $post;

	/**
	 * Stores the sample under pretty permalinks, as `RelatedResourcesBlockTest` sets them up.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();

		$file = self::markup_dir() . '/resource.json';
		$this->assertFileIsReadable( $file, 'packages/ui is not mounted: run `pnpm env:start` after a change to .wp-env.json.' );
		$this->sample = wp_json_file_decode( $file, array( 'associative' => true ) );

		// An administrator, who has `unfiltered_html` as editors on the CMS do, so kses stores the title's `&` as
		// typed and core renders it `&#038;`, the sample's form; with no user, kses would store `&amp;`.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$type   = $this->term( Taxonomies::TYPE, $this->sample['type'] );
		$topics = array_map( fn ( array $topic ): int => $this->term( Taxonomies::TOPIC, $topic ), $this->sample['topics'] );

		$this->post = self::factory()->post->create(
			array(
				'post_type'     => PostType::NAME,
				'post_status'   => 'publish',
				'post_title'    => $this->sample['title']['raw'],
				'post_name'     => $this->sample['slug'],
				'post_date_gmt' => str_replace( 'T', ' ', $this->sample['date_gmt'] ),
			)
		);
		wp_set_object_terms( $this->post, array( $type ), Taxonomies::TYPE );
		wp_set_object_terms( $this->post, $topics, Taxonomies::TOPIC );
		update_post_meta( $this->post, Meta::SUMMARY, wp_slash( MetaRules::sanitize_summary( $this->sample['summary'] ) ) );

		self::reset_type_accents();
		$row = TypeAccents::table()[ $this->sample['type']['id'] ] ?? null;
		$this->assertNotNull( $row, 'The sample\'s type ID has no row in build/type-accents.json: run `pnpm build`, or fix the sample.' );
		self::use_type_accents( array( $type => $row ) );
	}

	/**
	 * Back to plain permalinks and to the build's type-accent table.
	 */
	public function tear_down(): void {
		self::reset_type_accents();
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * Storing the sample gives back the REST API's forms the front end's test feeds it.
	 */
	public function test_the_stored_sample_is_the_sample(): void {
		$post = get_post( $this->post );

		$this->assertSame( $this->sample['title']['rendered'], get_the_title( $post ) );
		$this->assertSame( $this->sample['summary'], get_post_meta( $this->post, Meta::SUMMARY, true ) );
		$this->assertSame( $this->sample['date_gmt'], str_replace( ' ', 'T', $post->post_date_gmt ) );
		$this->assertSame( $this->sample['type']['name'], get_the_terms( $post, Taxonomies::TYPE )[0]->name );

		$topics = get_the_terms( $post, Taxonomies::TOPIC );
		$this->assertSame(
			array_column( $this->sample['topics'], 'name' ),
			array_map( fn ( WP_Term $term ): string => $term->name, $topics ),
			'The topics are stored with these names and come back in this order.'
		);
		$this->assertSame( array_column( $this->sample['topics'], 'slug' ), wp_list_pluck( $topics, 'slug' ) );
	}

	/**
	 * The card block renders `resource-card.html`, the front end's listing row at its default `h2`.
	 */
	public function test_resource_card_matches_the_fixture(): void {
		$this->assertSame( self::fixture( 'resource-card.html' ), self::normalise( $this->render( ResourceCardBlock::NAME ) ) );
	}

	/**
	 * The meta block renders `resource-meta.html`, the front end's resource page's meta line.
	 */
	public function test_resource_meta_matches_the_fixture(): void {
		$this->assertSame( self::fixture( 'resource-meta.html' ), self::normalise( $this->render( ResourceMetaBlock::NAME ) ) );
	}

	/**
	 * A term from the sample, created with the stored name core would keep for it; its ID.
	 *
	 * Core stores a name's `&` as `&amp;`, the form the sample holds, so the name is decoded on the way in
	 * and `test_the_stored_sample_is_the_sample()` checks it is stored as the sample says.
	 *
	 * @param string               $taxonomy The taxonomy.
	 * @param array<string, mixed> $term     The sample's term.
	 */
	private function term( string $taxonomy, array $term ): int {
		return self::factory()->term->create(
			array(
				'taxonomy' => $taxonomy,
				'name'     => wp_specialchars_decode( $term['name'] ),
				'slug'     => $term['slug'],
			)
		);
	}

	/**
	 * One block, rendered for the sample through `WP_Block`, with the context a post template gives it.
	 *
	 * @param string $name The block's name.
	 */
	private function render( string $name ): string {
		$parsed = array(
			'blockName'    => $name,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		);

		return ( new WP_Block(
			$parsed,
			array(
				'postId'   => $this->post,
				'postType' => PostType::NAME,
			)
		) )->render();
	}

	/**
	 * The markup with the parser's insignificant differences and the CMS's origin removed (see the class docblock).
	 *
	 * @param string $html A render or a fixture.
	 */
	private static function normalise( string $html ): string {
		$html = str_replace( 'href="' . untrailingslashit( home_url() ) . '/', 'href="/', $html );
		$html = (string) preg_replace( '/>\s*\n\s*</', '><', $html );
		$html = (string) preg_replace_callback( '/ ([A-Za-z][\w:.-]*)="/', fn ( array $m ): string => ' ' . strtolower( $m[1] ) . '="', $html );

		return trim( $html );
	}

	/**
	 * A fixture from `packages/ui/fixtures/markup/`, normalised.
	 *
	 * @param string $name The file's name.
	 */
	private static function fixture( string $name ): string {
		$file = self::markup_dir() . '/' . $name;
		self::assertFileIsReadable( $file );

		return self::normalise( (string) file_get_contents( $file ) ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- A local contract fixture, read by a test, never a remote URL.
	}

	/**
	 * Where the contract's markup fixtures are.
	 */
	private static function markup_dir(): string {
		return SchemaValidator::fixtures_dir() . '/markup';
	}
}
