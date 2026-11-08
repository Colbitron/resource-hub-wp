<?php
/**
 * The index is rebuilt only when it is out of date; the reasons are in `src/Search/SearchIndex.php`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Plugin;
use ResourceHub\Search\SearchIndex;
use WP_UnitTestCase;

/**
 * Each test starts with one published resource and a complete, stamped build, then changes one
 * thing and checks whether the next unforced build rebuilds. A rebuild is seen by Relevanssi's
 * truncate running, counted on its `relevanssi_truncate_index` filter.
 */
final class SearchIndexTest extends WP_UnitTestCase {
	use BuildsSearchIndex;

	/**
	 * How many times Relevanssi emptied the index.
	 *
	 * @var int
	 */
	private int $truncates = 0;

	/**
	 * The published resource.
	 *
	 * @var int
	 */
	private int $resource;

	/**
	 * Makes builds safe, counts truncates, creates a resource and builds once.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_transaction_safe_builds();

		add_filter(
			'relevanssi_truncate_index',
			function ( string $query ): string {
				++$this->truncates;
				return $query;
			},
			20
		);

		$this->resource = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Lantern almanac',
			)
		);
		update_post_meta( $this->resource, Meta::SUMMARY, 'A field guide.' );

		$this->build_index();
		$this->truncates = 0;
	}

	/**
	 * With nothing changed, an unforced build touches nothing: no truncate, the rows stay.
	 */
	public function test_a_current_index_is_left_alone(): void {
		$rows = $this->index_rows( $this->resource );

		$this->assertNull( ( new SearchIndex() )->stale_reason() );
		$result = ( new SearchIndex() )->build();

		$this->assertIsArray( $result );
		$this->assertFalse( $result['built'] );
		$this->assertSame( 0, $this->truncates );
		$this->assertSame( $rows, $this->index_rows( $this->resource ) );
		$this->assertGreaterThan( 0, $rows );
	}

	/**
	 * `--force` rebuilds a current index.
	 */
	public function test_force_rebuilds_a_current_index(): void {
		$result = ( new SearchIndex() )->build( true );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['built'] );
		$this->assertSame( 'forced', $result['reason'] );
		$this->assertSame( 1, $this->truncates );
	}

	/**
	 * Each change that makes the index out of date leads the next unforced build to rebuild once,
	 * after which it is current again.
	 *
	 * @dataProvider stale_provider
	 *
	 * @param string $change What changes, by name: see the match below.
	 */
	public function test_a_stale_index_is_rebuilt_once( string $change ): void {
		global $relevanssi_variables;
		$saved = $relevanssi_variables;

		match ( $change ) {
			'relevanssi not indexed' => update_option( 'relevanssi_indexed', '' ),
			'relevanssi version'     => $relevanssi_variables['plugin_version']   = '0.0.1', // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
			'relevanssi database'    => $relevanssi_variables['database_version'] = 1, // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
			'taxonomies'             => add_filter( 'pre_option_relevanssi_index_taxonomies_list', static fn(): array => array( Taxonomies::TOPIC ), 20 ),
			'statuses'               => add_filter( 'relevanssi_valid_status', static fn(): array => array( 'publish', 'private' ), 20 ),
			'stamp missing'          => SearchIndex::forget(),
		};

		try {
			$this->assertNotNull( ( new SearchIndex() )->stale_reason() );

			$result = ( new SearchIndex() )->build();
			$this->assertIsArray( $result );
			$this->assertTrue( $result['built'] );
			$this->assertSame( 1, $this->truncates );

			$this->assertNull( ( new SearchIndex() )->stale_reason() );
			$this->assertFalse( ( new SearchIndex() )->build()['built'] );
			$this->assertSame( 1, $this->truncates );
		} finally {
			$relevanssi_variables = $saved; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited, WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global, restored.
		}
	}

	/**
	 * The changes that make the index out of date.
	 *
	 * @return array<string, array{string}>
	 */
	public static function stale_provider(): array {
		return array(
			'Relevanssi has no complete index' => array( 'relevanssi not indexed' ),
			"Relevanssi's version changed"     => array( 'relevanssi version' ),
			"Relevanssi's database changed"    => array( 'relevanssi database' ),
			'the indexed taxonomies changed'   => array( 'taxonomies' ),
			'the indexed statuses changed'     => array( 'statuses' ),
			'no build was recorded'            => array( 'stamp missing' ),
		);
	}

	/**
	 * Activating or deactivating Relevanssi, or activating this plugin, forgets the stamp; another
	 * plugin's activation does not.
	 */
	public function test_activation_changes_forget_the_stamp(): void {
		$this->assertIsString( get_option( SearchIndex::STAMP_OPTION ) );

		do_action( 'activated_plugin', 'hello.php', false ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound
		$this->assertIsString( get_option( SearchIndex::STAMP_OPTION ) );

		foreach ( array( 'activated_plugin', 'deactivated_plugin' ) as $hook ) {
			$this->build_index();
			do_action( $hook, 'relevanssi/relevanssi.php', false ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.DynamicHooknameFound
			$this->assertFalse( get_option( SearchIndex::STAMP_OPTION ), $hook );
		}

		$this->build_index();
		Plugin::activate();
		$this->assertFalse( get_option( SearchIndex::STAMP_OPTION ) );
	}

	/**
	 * The stamp is not autoloaded, since only the CLI command reads it.
	 */
	public function test_the_stamp_is_not_autoloaded(): void {
		global $wpdb;

		$autoload = $wpdb->get_var( $wpdb->prepare( "SELECT autoload FROM {$wpdb->options} WHERE option_name = %s", SearchIndex::STAMP_OPTION ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery

		$this->assertContains( $autoload, array( 'off', 'no' ) );
	}
}
