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
	 * Every pinned option reads the code's value whatever is stored, as a save on Relevanssi's
	 * settings screen would store it. The pin is lifted while the value is stored, since with it in
	 * place `add_option()` sees the filtered value and stores nothing.
	 */
	public function test_every_pinned_option_is_answered_from_code(): void {
		foreach ( RelevanssiConfig::PINNED as $option => $expected ) {
			$stored = is_array( $expected ) ? array( 'stored' => 'by the settings screen' ) : 'stored-by-the-settings-screen';

			remove_all_filters( 'pre_option_' . $option );
			update_option( $option, $stored );
			$this->assertSame( $stored, get_option( $option ), $option );
		}

		( new RelevanssiConfig() )->register();

		foreach ( RelevanssiConfig::PINNED as $option => $expected ) {
			$this->assertSame( $expected, get_option( $option ), $option );
		}
	}

	/**
	 * The values that matter, spelled out, so a change to the table is a change to this test too.
	 */
	public function test_the_pinned_values(): void {
		$this->assertSame( 'off', get_option( 'relevanssi_log_queries' ) );
		$this->assertSame( 'off', get_option( 'relevanssi_admin_search' ) );
		$this->assertSame( array( 'resource', 'page' ), get_option( 'relevanssi_index_post_types' ) );
		$this->assertSame( 'summary', get_option( 'relevanssi_index_fields' ) );
		$this->assertSame( array( 'resource_topic', 'resource_type' ), get_option( 'relevanssi_index_taxonomies_list' ) );
		$this->assertSame( 'none', get_option( 'relevanssi_index_comments' ) );
		$this->assertSame( 'off', get_option( 'relevanssi_index_author' ) );
		$this->assertSame( 'off', get_option( 'relevanssi_index_excerpt' ) );
		$this->assertSame( 'off', get_option( 'relevanssi_expand_shortcodes' ) );
		$this->assertSame( '3', get_option( 'relevanssi_min_word_length' ) );
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

	/**
	 * Relevanssi never blanks the SQL of a search it will not answer.
	 */
	public function test_default_request_is_never_prevented(): void {
		$this->assertFalse( apply_filters( 'relevanssi_prevent_default_request', true, new WP_Query() ) ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Relevanssi's hook.
	}

	/**
	 * The related-resources block is dropped before Relevanssi renders it for the index; any other
	 * block, and a value another filter already dropped, pass through.
	 */
	public function test_only_the_related_block_is_dropped(): void {
		$config = new RelevanssiConfig();

		$this->assertNull( $config->block_to_render( array( 'blockName' => 'resource-hub/related-resources' ) ) );
		$this->assertSame( array( 'blockName' => 'core/paragraph' ), $config->block_to_render( array( 'blockName' => 'core/paragraph' ) ) );
		$this->assertNull( $config->block_to_render( null ) );
		$this->assertNull( apply_filters( 'relevanssi_block_to_render', array( 'blockName' => 'resource-hub/related-resources' ) ) ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Relevanssi's hook.
	}
}
