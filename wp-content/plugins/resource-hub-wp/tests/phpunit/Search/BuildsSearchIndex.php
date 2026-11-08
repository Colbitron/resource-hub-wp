<?php
/**
 * What a test needs to build Relevanssi's index inside its own transaction.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\Search\SearchIndex;

/**
 * Relevanssi's full build truncates its table and analyzes it, and both statements commit MySQL's
 * open transaction, which would keep a test's posts after its rollback. So
 * {@see BuildsSearchIndex::use_transaction_safe_builds()} turns the truncate into a `DELETE`
 * through Relevanssi's own filter and the analyze into a no-op, and answers locally the build's
 * fire-and-forget request to `admin-ajax.php` and the `wp-cron.php` request `spawn_cron()` makes.
 * None of these changes what the index holds.
 */
trait BuildsSearchIndex {
	/**
	 * Fails without Relevanssi, unless the suite was asked to run without it, and makes builds safe.
	 */
	private function use_transaction_safe_builds(): void {
		if ( getenv( 'RESOURCE_HUB_TESTS_WITHOUT_RELEVANSSI' ) ) {
			$this->markTestSkipped( 'The suite is running without Relevanssi.' );
		}

		$this->assertTrue( ( new SearchIndex() )->available(), 'Relevanssi is not loaded. Run `pnpm env:start`, whose afterStart installs it from site-plugins/.' );

		global $wpdb;
		$table = $wpdb->prefix . 'relevanssi';

		add_filter( 'relevanssi_truncate_index', static fn(): string => "DELETE FROM {$table}" );
		add_filter( 'query', static fn( string $query ): string => str_starts_with( $query, 'ANALYZE TABLE' ) ? 'SELECT 1' : $query );
		add_filter(
			'pre_http_request',
			static fn( $pre, array $args, string $url ) => ( str_contains( $url, 'admin-ajax.php' ) || str_contains( $url, 'wp-cron.php' ) ) ? array(
				'headers'  => array(),
				'body'     => '',
				'response' => array(
					'code'    => 200,
					'message' => 'OK',
				),
				'cookies'  => array(),
			) : $pre,
			10,
			3
		);
	}

	/**
	 * Rebuilds the index the way `wp resource-hub search-index --force` does.
	 */
	private function build_index(): void {
		$result = ( new SearchIndex() )->build( true );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['built'] );
		$this->assertTrue( $result['complete'] );
	}

	/**
	 * How many index rows a post has.
	 *
	 * @param int $post_id The post.
	 */
	private function index_rows( int $post_id ): int {
		global $wpdb;

		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->prefix}relevanssi WHERE doc = %d", $post_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}
}
