<?php
/**
 * The plugin's half of the contract's markup fixtures (`packages/ui/README.md`, "Markup fixtures").
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Blocks;

use ResourceHub\Blocks\RelatedBlock;
use ResourceHub\Blocks\ResourceCardBlock;
use ResourceHub\Blocks\ResourceMetaBlock;
use ResourceHub\Blocks\TypeAccents;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\MetaRules;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Rest\RelatedItems;
use ResourceHub\Tests\Revalidation\SchemaValidator;
use WP_Block;
use WP_Term;
use WP_UnitTestCase;

/**
 * Each sample resource in `packages/ui/fixtures/markup/{case}.json`, stored with core's functions, renders
 * through the `resource-card` and `resource-meta` blocks exactly as `{case}.card.html` and
 * `{case}.meta.html` say, which is what the front end's `ResourceCard` and `ResourceArticle` render from
 * the same samples (`apps/web/test/markup-parity.test.tsx`). The `related` block renders the first three
 * samples, in name order, as the picks of a host resource exactly as `related.html` says, which is what
 * the front end's `RelatedList` renders from the same samples as the resource page's related section. So
 * a change to either side's markup fails one of the two tests until the fixtures, and the other side,
 * follow.
 *
 * The samples are in the REST API's forms, so this test first proves that storing each gives those forms
 * back (the rendered title, the stored term names, the stored summary), or the comparison would test a
 * resource the front end never receives. The type's mark is the table's row for the sample's type ID,
 * mapped onto the term the tests database creates, which has another ID; a sample whose type has no row
 * gets an empty table, so its mark is neutral, as the front end's is.
 *
 * The comparison normalises what the HTML parser ignores, as the front end's test does: whitespace holding
 * a line break between two tags (the fixtures' indentation), the case of attribute names (React writes
 * `dateTime`), and the spelling of a numeric character reference (React writes `'` as `&#x27;`, PHP as
 * `&#039;`). And one thing the contract says differs: links here are absolute, `get_permalink()` and
 * `home_url()`, where the front end's are root-relative, since it strips the CMS's origin from every link
 * and the paths are the same on both sites (`packages/ui/README.md`, "Public URL shape"), so the CMS's
 * origin is removed from each `href` before comparing. Every other byte counts.
 */
final class MarkupParityTest extends WP_UnitTestCase {
	use SetsTypeAccentsTable;

	/**
	 * The type-accent rows the stored samples' types have been given so far, by term ID (`store()`).
	 *
	 * @var array<int, array{slug: string, accent: string}>
	 */
	private array $accents = array();

	/**
	 * Pretty permalinks (see `RelatedResourcesBlockTest::set_up()`), and an administrator, who has
	 * `unfiltered_html` as editors on the CMS do, so kses stores a title's `&` as typed and core renders it
	 * `&#038;`, the samples' form; with no user, kses would store `&amp;`.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
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
	 * The cases, one per sample file; the front end's test reads the same directory.
	 *
	 * @return array<string, array{string}>
	 */
	public static function cases(): array {
		$cases = array();
		$files = glob( self::markup_dir() . '/*.json' );

		foreach ( false === $files ? array() : $files as $file ) {
			$name           = basename( $file, '.json' );
			$cases[ $name ] = array( $name );
		}

		return $cases;
	}

	/**
	 * The samples are there, each with its two fixtures.
	 */
	public function test_finds_the_samples(): void {
		$this->assertFileIsReadable( self::markup_dir() . '/full.json', 'packages/ui is not mounted: run `pnpm env:start` after a change to .wp-env.json.' );

		foreach ( array( 'bare', 'full', 'unmapped' ) as $name ) {
			$this->assertArrayHasKey( $name, self::cases() );
		}

		foreach ( array_keys( self::cases() ) as $name ) {
			$this->assertFileIsReadable( self::markup_dir() . '/' . $name . '.card.html' );
			$this->assertFileIsReadable( self::markup_dir() . '/' . $name . '.meta.html' );
		}

		$this->assertFileIsReadable( self::markup_dir() . '/related.html' );
	}

	/**
	 * Storing a sample gives back the REST API's forms the front end's test feeds it.
	 *
	 * @dataProvider cases
	 *
	 * @param string $name The case.
	 */
	public function test_the_stored_sample_is_the_sample( string $name ): void {
		$sample = self::sample( $name );
		$post   = get_post( $this->store( $sample ) );

		$this->assertSame( $sample['title']['rendered'], get_the_title( $post ) );
		$this->assertSame( $sample['summary'], get_post_meta( $post->ID, Meta::SUMMARY, true ) );
		$this->assertSame( $sample['date_gmt'], str_replace( ' ', 'T', $post->post_date_gmt ) );
		$this->assertSame( $sample['type']['name'], get_the_terms( $post, Taxonomies::TYPE )[0]->name );

		$topics = get_the_terms( $post, Taxonomies::TOPIC );
		$topics = is_array( $topics ) ? $topics : array();
		$this->assertSame(
			array_column( $sample['topics'], 'name' ),
			array_map( fn ( WP_Term $term ): string => $term->name, $topics ),
			'The topics are stored with these names and come back in this order.'
		);
		$this->assertSame( array_column( $sample['topics'], 'slug' ), wp_list_pluck( $topics, 'slug' ) );
	}

	/**
	 * The card block renders `{case}.card.html`, the front end's listing row at its default `h2`.
	 *
	 * @dataProvider cases
	 *
	 * @param string $name The case.
	 */
	public function test_resource_card_matches_the_fixture( string $name ): void {
		$post = $this->store( self::sample( $name ) );

		$this->assertSame( self::fixture( $name . '.card.html' ), self::normalise( $this->render( ResourceCardBlock::NAME, $post ) ) );
	}

	/**
	 * The meta block renders `{case}.meta.html`, the front end's resource page's meta line.
	 *
	 * @dataProvider cases
	 *
	 * @param string $name The case.
	 */
	public function test_resource_meta_matches_the_fixture( string $name ): void {
		$post = $this->store( self::sample( $name ) );

		$this->assertSame( self::fixture( $name . '.meta.html' ), self::normalise( $this->render( ResourceMetaBlock::NAME, $post ) ) );
	}

	/**
	 * The related block renders `related.html` for a host whose picks are the first `RelatedItems::DEFAULT_COUNT`
	 * samples in name order: the front end's related section, `RelatedList` with the samples' rows at `h3`.
	 *
	 * Picks, so the order is the editor's and not the samples' dates; the count is the section's, so a fourth
	 * sample would not be a row. The host is a factory resource with no type, topics or picks of its own
	 * beyond the samples, which the block does not render anything of.
	 */
	public function test_related_section_matches_the_fixture(): void {
		$picks = array();

		foreach ( array_slice( array_keys( self::cases() ), 0, RelatedItems::DEFAULT_COUNT ) as $name ) {
			$picks[] = $this->store( self::sample( $name ) );
		}

		$host = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
			)
		);
		update_post_meta( $host, Meta::RELATED_PICKS, $picks );

		$this->assertSame( self::fixture( 'related.html' ), self::normalise( $this->render( RelatedBlock::NAME, $host ) ) );
	}

	/**
	 * Stores a sample as a published resource, with its type's accent row mapped onto the type's term; its ID.
	 *
	 * @param array<string, mixed> $sample The decoded sample.
	 */
	private function store( array $sample ): int {
		$type   = $this->term( Taxonomies::TYPE, $sample['type'] );
		$topics = array_map( fn ( array $topic ): int => $this->term( Taxonomies::TOPIC, $topic ), $sample['topics'] );

		$post = self::factory()->post->create(
			array(
				'post_type'     => PostType::NAME,
				'post_status'   => 'publish',
				'post_title'    => $sample['title']['raw'],
				'post_name'     => $sample['slug'],
				'post_date_gmt' => str_replace( 'T', ' ', $sample['date_gmt'] ),
			)
		);
		wp_set_object_terms( $post, array( $type ), Taxonomies::TYPE );
		wp_set_object_terms( $post, $topics, Taxonomies::TOPIC );
		update_post_meta( $post, Meta::SUMMARY, wp_slash( MetaRules::sanitize_summary( $sample['summary'] ) ) );

		// The build's row for the sample's type ID, if any, mapped onto the term made here; earlier samples' rows kept.
		self::reset_type_accents();
		$row = TypeAccents::table()[ $sample['type']['id'] ] ?? null;
		if ( null !== $row ) {
			$this->accents[ $type ] = $row;
		}
		self::use_type_accents( $this->accents );

		return $post;
	}

	/**
	 * A term from a sample, created with the stored name core would keep for it; its ID.
	 *
	 * Core stores a name's `&` as `&amp;`, the form the samples hold, so the name is decoded on the way in
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
	 * One block, rendered for a post through `WP_Block`, with the context a post template gives it.
	 *
	 * @param string $name The block's name.
	 * @param int    $post The post.
	 */
	private function render( string $name, int $post ): string {
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
				'postId'   => $post,
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
		$html = (string) preg_replace_callback(
			'/&#(x[0-9a-f]+|[0-9]+);/i',
			fn ( array $m ): string => '&#x' . dechex( 'x' === strtolower( $m[1][0] ) ? (int) hexdec( substr( $m[1], 1 ) ) : (int) $m[1] ) . ';',
			$html
		);

		return trim( $html );
	}

	/**
	 * A sample, decoded.
	 *
	 * @param string $name The case.
	 * @return array<string, mixed>
	 */
	private static function sample( string $name ): array {
		return wp_json_file_decode( self::markup_dir() . '/' . $name . '.json', array( 'associative' => true ) );
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
