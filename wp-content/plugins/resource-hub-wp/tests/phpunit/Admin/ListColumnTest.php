<?php
/**
 * The "Revalidation" column on the Resources and Pages lists (see `docs/architecture/revalidation.md`).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Admin;

use ResourceHub\Admin\ListColumn;
use ResourceHub\ContentModel\PostType;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use WP_UnitTestCase;

/**
 * Tests for {@see ListColumn}: registration, the default hiding, and what a cell prints.
 */
final class ListColumnTest extends WP_UnitTestCase {
	/**
	 * A resource holding a record.
	 *
	 * @param array<string, mixed> $record The record to store.
	 */
	private static function resource_with( array $record ): int {
		$post_id = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		update_post_meta( $post_id, ResultStore::META_KEY, $record );

		return $post_id;
	}

	/**
	 * The column is hooked onto the resource and page lists, added after core's columns, and hidden by
	 * default on those two screens only.
	 */
	public function test_column_is_added_and_hidden_by_default(): void {
		$this->assertSame( array( PostType::NAME, 'page' ), ResultStore::POST_TYPES );
		$this->assertSame( array( 'edit-resource', 'edit-page' ), ListColumn::list_screens() );

		$column = new ListColumn();

		// The plugin registered its own instance, so the hooks are checked by name.
		foreach ( ResultStore::POST_TYPES as $post_type ) {
			$this->assertNotFalse( has_filter( 'manage_' . $post_type . '_posts_columns' ), $post_type );
			$this->assertNotFalse( has_action( 'manage_' . $post_type . '_posts_custom_column' ), $post_type );

			$hidden = $column->hide_by_default( array(), convert_to_screen( 'edit-' . $post_type ) );
			$this->assertContains( ListColumn::COLUMN, $hidden, $post_type );
		}

		$this->assertNotFalse( has_filter( 'default_hidden_columns' ) );
		$this->assertFalse( has_filter( 'manage_post_posts_columns' ) );

		$columns = $column->add_column( array( 'title' => 'Title' ) );
		$this->assertSame( array( 'title', ListColumn::COLUMN ), array_keys( $columns ) );
		$this->assertSame( 'Revalidation', $columns[ ListColumn::COLUMN ] );

		$elsewhere = $column->hide_by_default( array(), convert_to_screen( 'edit-post' ) );
		$this->assertNotContains( ListColumn::COLUMN, $elsewhere );
	}

	/**
	 * A page's cell reads the page's own record, the one `PageEvents` stores, like a resource's.
	 */
	public function test_page_cell_shows_its_record(): void {
		$page_id = self::factory()->post->create( array( 'post_type' => 'page' ) );
		update_post_meta(
			$page_id,
			ResultStore::META_KEY,
			ResultTextTest::record(
				array(
					'status'  => Result::FAILED,
					'outcome' => Result::NOT_CONFIGURED,
					'event'   => 'update',
					'time'    => '2027-01-15T10:00:00Z',
				)
			)
		);

		$cell = ListColumn::cell( $page_id, (int) strtotime( '2027-01-15T10:05:00Z' ) );

		$this->assertStringContainsString( '>Not configured<', $cell );
		$this->assertStringContainsString( '>5 minutes ago</time>', $cell );
	}

	/**
	 * The cell holds the label and the relative time, with the exact time in the `<time>` title, and the
	 * rendering action prints it only for this column.
	 */
	public function test_cell_shows_label_and_time(): void {
		$at      = (int) strtotime( '2027-01-15T10:00:00Z' );
		$post_id = self::resource_with(
			ResultTextTest::record(
				array(
					'status'  => Result::SENT,
					'outcome' => Result::OK,
					'code'    => 200,
					'time'    => '2027-01-15T10:00:00Z',
				)
			)
		);

		$cell = ListColumn::cell( $post_id, $at + 120 );

		$this->assertStringContainsString( '>Accepted<', $cell );
		$this->assertStringContainsString( '>2 minutes ago</time>', $cell );
		$this->assertStringContainsString( 'datetime="2027-01-15T10:00:00+00:00"', $cell );

		$column = new ListColumn();

		ob_start();
		$column->render_cell( ListColumn::COLUMN, $post_id );
		$printed = (string) ob_get_clean();
		$this->assertStringContainsString( '>Accepted<', $printed );

		ob_start();
		$column->render_cell( 'title', $post_id );
		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * A failure is marked as such, with its label; the response body and the error text never appear.
	 */
	public function test_cell_never_shows_the_body(): void {
		$post_id = self::resource_with(
			ResultTextTest::record(
				array(
					'outcome' => Result::UNAUTHORIZED,
					'code'    => 401,
					'body'    => '{"error":"unauthorized","secret_hint":"BODY-MUST-NOT-APPEAR"}',
					'error'   => 'ERROR-MUST-NOT-APPEAR',
				)
			)
		);

		$cell = ListColumn::cell( $post_id );

		$this->assertStringContainsString( '>Rejected (401)<', $cell );
		$this->assertStringNotContainsString( 'BODY-MUST-NOT-APPEAR', $cell );
		$this->assertStringNotContainsString( 'ERROR-MUST-NOT-APPEAR', $cell );
	}

	/**
	 * A fresh `pending` reads as pending; one older than five minutes reads as no answer recorded.
	 */
	public function test_cell_stale_pending(): void {
		$written = 1_800_000_000;
		$post_id = self::resource_with(
			ResultTextTest::record(
				array(
					'status'  => ResultStore::PENDING,
					'outcome' => ResultStore::PENDING,
					'code'    => null,
					'time'    => gmdate( 'Y-m-d\TH:i:s\Z', $written ),
				)
			)
		);

		$this->assertStringContainsString( '>Pending<', ListColumn::cell( $post_id, $written + 30 ) );
		$this->assertStringContainsString( '>No answer recorded<', ListColumn::cell( $post_id, $written + 600 ) );
	}

	/**
	 * Every value is escaped: a record tampered with to hold markup prints as text.
	 */
	public function test_cell_escapes(): void {
		$post_id = self::resource_with(
			ResultTextTest::record(
				array(
					'status'  => '<b>failed</b>',
					'outcome' => '<script>alert(1)</script>',
					'time'    => '2027-01-15T10:00:00Z',
				)
			)
		);

		$cell = ListColumn::cell( $post_id );

		$this->assertStringNotContainsString( '<script>', $cell );
		$this->assertStringNotContainsString( '<b>', $cell );
		$this->assertStringContainsString( '>Failed<', $cell );
	}

	/**
	 * A resource with no record shows a dash, with text for screen readers.
	 */
	public function test_cell_without_a_record(): void {
		$post_id = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );

		$cell = ListColumn::cell( $post_id );

		$this->assertStringContainsString( '&mdash;', $cell );
		$this->assertStringContainsString( 'No revalidation recorded', $cell );
	}
}
