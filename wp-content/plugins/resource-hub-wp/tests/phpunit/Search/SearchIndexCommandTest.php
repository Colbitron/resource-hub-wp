<?php
/**
 * `wp resource-hub search-index [--force]`; the reasons are in `src/Search/SearchIndex.php`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\Cli\SearchIndexCommand;
use ResourceHub\ContentModel\PostType;
use ResourceHub\Search\SearchIndex;
use WP_CLI;
use WP_UnitTestCase;

require_once __DIR__ . '/stubs/class-wp-cli.php';
require_once __DIR__ . '/stubs/wp-cli-utils.php';

/**
 * Runs the command class against the stubs in `stubs/` and reads what it printed.
 */
final class SearchIndexCommandTest extends WP_UnitTestCase {
	use BuildsSearchIndex;

	/**
	 * Makes builds safe, clears the printed lines, and creates one resource.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->use_transaction_safe_builds();
		WP_CLI::$lines = array();

		self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Lantern almanac',
			)
		);
	}

	/**
	 * A stale index is rebuilt, with the reason and the count printed; the next run finds it
	 * current and says so; `--force` rebuilds it anyway.
	 */
	public function test_stale_then_current_then_forced(): void {
		SearchIndex::forget();

		$this->command();
		$this->assertSame( 'success', WP_CLI::$lines[0][0] );
		$this->assertMatchesRegularExpression( '/^Search index rebuilt \((Relevanssi has no complete index|no build has been recorded)\): \d+ posts indexed\.$/', WP_CLI::$lines[0][1] );

		$this->command();
		$this->assertSame( array( 'success', 'Search index is current; nothing rebuilt. Use --force to rebuild anyway.' ), WP_CLI::$lines[1] );

		$this->command( array( 'force' => true ) );
		$this->assertSame( 'success', WP_CLI::$lines[2][0] );
		$this->assertStringStartsWith( 'Search index rebuilt (forced): ', WP_CLI::$lines[2][1] );
	}

	/**
	 * Without Relevanssi the command fails with a plain message and touches no stamp.
	 */
	public function test_without_relevanssi_it_fails(): void {
		$this->build_index();
		$stamp = get_option( SearchIndex::STAMP_OPTION );

		$this->assert_fails( 'Relevanssi is not active, so there is no search index to build.', new SearchIndex( null, false ) );
		$this->assertSame( $stamp, get_option( SearchIndex::STAMP_OPTION ) );
	}

	/**
	 * A build Relevanssi reports incomplete fails the command, so a script notices.
	 */
	public function test_an_incomplete_build_fails(): void {
		$this->assert_fails( 'The index build stopped after 2 posts.', new SearchIndex( static fn(): array => array( false, 2 ) ), array( 'force' => true ) );
	}

	/**
	 * Runs the command and checks it stopped with this error, as its only line.
	 *
	 * @param string               $message    The error expected.
	 * @param SearchIndex          $index      The index to build.
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	private function assert_fails( string $message, SearchIndex $index, array $assoc_args = array() ): void {
		try {
			( new SearchIndexCommand( $index ) )( array(), $assoc_args );
			$this->fail( 'The command was expected to fail.' );
		} catch ( \RuntimeException $e ) {
			$this->assertSame( $message, $e->getMessage() );
		}

		$this->assertSame( array( array( 'error', $message ) ), WP_CLI::$lines );
	}

	/**
	 * Runs the command.
	 *
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	private function command( array $assoc_args = array() ): void {
		( new SearchIndexCommand() )( array(), $assoc_args );
	}
}
