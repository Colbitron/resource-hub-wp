<?php
/**
 * Relevanssi's settings are answered from code; the reasons are in `src/Search/RelevanssiConfig.php`.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Search;

use ResourceHub\Search\RelevanssiConfig;
use WP_Query;
use WP_UnitTestCase;

/**
 * Runs with or without Relevanssi loaded: the filters answer either way.
 */
final class RelevanssiConfigTest extends WP_UnitTestCase {
	/**
	 * Each pinned option reads the code's value whatever is stored, which is what a save on
	 * Relevanssi's settings screen would store. The pin is lifted while the value is stored, since
	 * with it in place `add_option()` sees the filtered value and stores nothing.
	 *
	 * @dataProvider pinned_provider
	 *
	 * @param string $option   The option name.
	 * @param mixed  $stored   A value saved to the database.
	 * @param mixed  $expected What `get_option()` must answer.
	 */
	public function test_option_is_answered_from_code( string $option, $stored, $expected ): void {
		remove_all_filters( 'pre_option_' . $option );
		update_option( $option, $stored );
		$this->assertSame( $stored, get_option( $option ) );

		( new RelevanssiConfig() )->register();

		$this->assertSame( $expected, get_option( $option ) );
	}

	/**
	 * Relevanssi never blanks the SQL of a search it will not answer.
	 */
	public function test_default_request_is_never_prevented(): void {
		$this->assertFalse( apply_filters( 'relevanssi_prevent_default_request', true, new WP_Query() ) ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Relevanssi's hook.
	}

	/**
	 * The four pinned options, each stored as Relevanssi's settings screen could store it.
	 *
	 * @return array<string, array{string, mixed, mixed}>
	 */
	public static function pinned_provider(): array {
		return array(
			'logging'    => array( 'relevanssi_log_queries', 'on', 'off' ),
			'post types' => array( 'relevanssi_index_post_types', array( 'post', 'page', 'attachment' ), array( 'resource', 'page' ) ),
			'meta'       => array( 'relevanssi_index_fields', 'all', 'summary' ),
			'taxonomies' => array( 'relevanssi_index_taxonomies_list', array( 'category' ), array( 'resource_topic', 'resource_type' ) ),
		);
	}

	/**
	 * Reading a pinned option with nothing stored writes nothing: the value never touches the
	 * database.
	 */
	public function test_reading_writes_nothing(): void {
		delete_option( 'relevanssi_index_post_types' );

		$this->assertSame( array( 'resource', 'page' ), get_option( 'relevanssi_index_post_types' ) );

		remove_all_filters( 'pre_option_relevanssi_index_post_types' );
		wp_cache_delete( 'relevanssi_index_post_types', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		$this->assertFalse( get_option( 'relevanssi_index_post_types' ) );
	}
}
