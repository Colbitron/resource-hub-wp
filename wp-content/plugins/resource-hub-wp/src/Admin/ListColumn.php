<?php
/**
 * The "Revalidation" column on the Resources and Pages lists.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Admin;

use ResourceHub\Revalidation\ResultStore;
use WP_Screen;

/**
 * Shows each resource's or page's last revalidation result in a few words plus its time, for the
 * saves that never open the block editor: bulk actions, the trash and Quick Edit. One
 * class for every post type in {@see ResultStore::POST_TYPES}, since each list saves the same way.
 * Hidden by default through `default_hidden_columns`; Screen Options turns it on. It never prints
 * the response body.
 */
final class ListColumn {
	/**
	 * Column key.
	 */
	public const COLUMN = 'rh_revalidation';

	/**
	 * Hooks the column onto the `resource` and `page` list tables.
	 */
	public function register(): void {
		foreach ( ResultStore::POST_TYPES as $post_type ) {
			add_filter( 'manage_' . $post_type . '_posts_columns', array( $this, 'add_column' ) );
			add_action( 'manage_' . $post_type . '_posts_custom_column', array( $this, 'render_cell' ), 10, 2 );
		}

		add_filter( 'default_hidden_columns', array( $this, 'hide_by_default' ), 10, 2 );
	}

	/**
	 * Adds the column after the date. Hooked to `manage_{post_type}_posts_columns`.
	 *
	 * @param array<string, string> $columns The columns.
	 * @return array<string, string>
	 */
	public function add_column( $columns ): array {
		$columns                 = (array) $columns;
		$columns[ self::COLUMN ] = __( 'Revalidation', 'resource-hub' );

		return $columns;
	}

	/**
	 * Hides the column until someone turns it on in Screen Options. Hooked to `default_hidden_columns`.
	 *
	 * @param string[]  $hidden The columns hidden by default.
	 * @param WP_Screen $screen The screen.
	 * @return string[]
	 */
	public function hide_by_default( $hidden, $screen ): array {
		$hidden = (array) $hidden;

		if ( $screen instanceof WP_Screen && in_array( $screen->id, self::list_screens(), true ) ) {
			$hidden[] = self::COLUMN;
		}

		return $hidden;
	}

	/**
	 * The IDs of the list screens the column is on: `edit-resource` and `edit-page`.
	 *
	 * @return string[]
	 */
	public static function list_screens(): array {
		return array_map( static fn( string $post_type ): string => 'edit-' . $post_type, ResultStore::POST_TYPES );
	}

	/**
	 * Prints one row's cell. Hooked to `manage_{post_type}_posts_custom_column`.
	 *
	 * @param string $column  Column key.
	 * @param int    $post_id The row's post.
	 */
	public function render_cell( $column, $post_id ): void {
		if ( self::COLUMN !== $column ) {
			return;
		}

		echo self::cell( (int) $post_id ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- cell() escapes every value it prints.
	}

	/**
	 * The cell's HTML: the label, and the time as a `<time>` with the exact time in its title. An
	 * em dash when nothing is recorded yet.
	 *
	 * @param int      $post_id The row's post.
	 * @param int|null $now     Unix time for the stale check and the relative time; null means now.
	 */
	public static function cell( int $post_id, ?int $now = null ): string {
		$record = ResultStore::read_post( $post_id );

		if ( null === $record ) {
			return '<span aria-hidden="true">&mdash;</span><span class="screen-reader-text">' . esc_html__( 'No revalidation recorded', 'resource-hub' ) . '</span>';
		}

		$html = '<span>' . esc_html( ResultText::label( $record, $now ) ) . '</span>';
		$time = ResultText::timestamp( $record );

		if ( null !== $time ) {
			$html .= '<br><time datetime="' . esc_attr( gmdate( 'c', $time ) ) . '" title="' . esc_attr( ResultText::local_time( $record ) ) . '">' . esc_html( ResultText::relative_time( $record, $now ) ) . '</time>';
		}

		return $html;
	}
}
