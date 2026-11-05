<?php
/**
 * The "Revalidation" column on the Resources list (ADR 0018).
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
	 * The column is hooked onto the resource list, added after core's columns, and hidden by default
	 * on that screen only.
	 */
	public function test_column_is_added_and_hidden_by_default(): void {
		$this->assertNotFalse( has_filter( 'manage_' . PostType::NAME . '_posts_columns' ) );
		$this->assertNotFalse( has_action( 'manage_' . PostType::NAME . '_posts_custom_column' ) );
		$this->assertNotFalse( has_filter( 'default_hidden_columns' ) );

		$column  = new ListColumn();
		$columns = $column->add_column( array( 'title' => 'Title' ) );
		$this->assertSame( array( 'title', ListColumn::COLUMN ), array_keys( $columns ) );
		$this->assertSame( 'Revalidation', $columns[ ListColumn::COLUMN ] );

		$hidden = $column->hide_by_default( array(), convert_to_screen( 'edit-' . PostType::NAME ) );
		$this->assertContains( ListColumn::COLUMN, $hidden );

		$elsewhere = $column->hide_by_default( array(), convert_to_screen( 'edit-post' ) );
		$this->assertNotContains( ListColumn::COLUMN, $elsewhere );
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

		$this->assertStringContainsString( 'rh-revalidation--success', $cell );
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

		$this->assertStringContainsString( 'rh-revalidation--error', $cell );
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
		$this->assertStringContainsString( 'rh-revalidation--warning', ListColumn::cell( $post_id, $written + 600 ) );
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
