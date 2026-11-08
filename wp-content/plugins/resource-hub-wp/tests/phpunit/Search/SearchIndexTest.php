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
			'relevanssi database'    => $relevanssi_variables['database_version'] = (int) $relevanssi_variables['database_version'] + 1, // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
			'taxonomies'             => add_filter( 'pre_option_relevanssi_index_taxonomies_list', static fn(): array => array( Taxonomies::TOPIC ), 20 ),
			'statuses'               => add_filter( 'relevanssi_valid_status', static fn(): array => array( 'publish', 'private' ), 20 ),
			'stopwords'              => update_option( 'relevanssi_stopwords', array( 'en_US' => 'zzz' ) ),
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
			'the stopword list changed'        => array( 'stopwords' ),
			'no build was recorded'            => array( 'stamp missing' ),
		);
	}

	/**
	 * A setting the plugin pins, saved to the database as Relevanssi's settings screen would save
	 * it, changes nothing Relevanssi reads, so the index stays current.
	 */
	public function test_saving_a_pinned_setting_leaves_the_index_current(): void {
		update_option( 'relevanssi_index_comments', 'all' );
		update_option( 'relevanssi_expand_shortcodes', 'on' );

		$this->assertNull( ( new SearchIndex() )->stale_reason() );
	}

	/**
	 * After a Relevanssi upgrade that raises its database version, the build first brings the
	 * tables to that version, as Relevanssi's own admin load would, then stores a stamp that says
	 * so. The tables already have the current shape here, so the upgrade sends no DDL, which
	 * would commit the test's transaction; the check below would say if it did.
	 */
	public function test_the_tables_are_upgraded_before_a_build(): void {
		global $relevanssi_variables;
		$saved = $relevanssi_variables;
		$ddl   = array();
		$watch = static function ( string $query ) use ( &$ddl ): string {
			if ( preg_match( '/^\s*(ALTER|CREATE|DROP|RENAME)\b/i', $query ) ) {
				$ddl[] = $query;
			}
			return $query;
		};

		try {
			$relevanssi_variables['database_version'] = (int) get_option( 'relevanssi_db_version' ) + 1; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
			$this->assertSame( "Relevanssi's tables are not at its database version", ( new SearchIndex() )->stale_reason() );

			add_filter( 'query', $watch );
			$result = ( new SearchIndex() )->build();
			remove_filter( 'query', $watch );

			$this->assertSame( array(), $ddl, 'The upgrade sent DDL inside the test.' );
			$this->assertTrue( $result['built'] );
			$this->assertSame( $relevanssi_variables['database_version'], (int) get_option( 'relevanssi_db_version' ) );
			$this->assertNull( ( new SearchIndex() )->stale_reason() );
		} finally {
			$relevanssi_variables = $saved; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited, WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global, restored.
		}
	}

	/**
	 * A build that completes on tables the upgrade did not bring to Relevanssi's database version
	 * stores no stamp, so the next run tries again instead of calling old tables current.
	 */
	public function test_a_build_on_tables_left_behind_stores_no_stamp(): void {
		global $relevanssi_variables;
		$saved = $relevanssi_variables;
		add_filter( 'pre_update_option_relevanssi_db_version', static fn( $value, $old ) => $old, 10, 2 );

		try {
			$relevanssi_variables['database_version'] = (int) get_option( 'relevanssi_db_version' ) + 1; // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global.
			$result                                   = ( new SearchIndex( static fn(): array => array( true, 1 ) ) )->build();

			$this->assertTrue( $result['complete'] );
			$this->assertFalse( get_option( SearchIndex::STAMP_OPTION ) );
			$this->assertSame( "Relevanssi's tables are not at its database version", ( new SearchIndex() )->stale_reason() );
		} finally {
			$relevanssi_variables = $saved; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited, WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound -- Relevanssi's global, restored.
		}
	}

	/**
	 * A build Relevanssi reports incomplete, or one that dies part way, leaves no stamp, though the
	 * index was current before it: the stamp goes before the build starts, so an interrupted
	 * `--force` reads as stale on the next run.
	 */
	public function test_an_incomplete_or_interrupted_build_stores_no_stamp(): void {
		$this->assertIsString( get_option( SearchIndex::STAMP_OPTION ) );

		$result = ( new SearchIndex( static fn(): array => array( false, 3 ) ) )->build( true );

		$this->assertFalse( $result['complete'] );
		$this->assertSame( 3, $result['indexed'] );
		$this->assertFalse( get_option( SearchIndex::STAMP_OPTION ) );
		$this->assertNotNull( ( new SearchIndex() )->stale_reason() );

		$this->build_index();
		try {
			( new SearchIndex(
				static function (): array {
					throw new \RuntimeException( 'Killed.' );
				}
			) )->build( true );
			$this->fail( 'The build was expected to throw.' );
		} catch ( \RuntimeException $e ) {
			$this->assertSame( 'Killed.', $e->getMessage() );
		}
		$this->assertFalse( get_option( SearchIndex::STAMP_OPTION ) );
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
