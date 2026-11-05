<?php
/**
 * The last revalidation result on a topic's or type's edit screen.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Admin;

use ResourceHub\Revalidation\ResultStore;
use ResourceHub\Revalidation\TermEvents;
use WP_Term;

/**
 * Shows a term's `_rh_last_revalidation` as an inline admin notice at the top of its edit form
 * (ADRs 0017, 0018). The `{$taxonomy}_term_edit_form_top` action hands over the term itself, so
 * nothing is read from the request.
 */
final class TermNotice {
	/**
	 * Hooks the notice onto both taxonomies' edit screens.
	 */
	public function register(): void {
		foreach ( TermEvents::TAXONOMIES as $taxonomy ) {
			add_action( $taxonomy . '_term_edit_form_top', array( $this, 'render' ) );
		}
	}

	/**
	 * Prints the notice, or nothing when the term has no result. Hooked to `{$taxonomy}_term_edit_form_top`.
	 *
	 * @param WP_Term $term The term being edited.
	 */
	public function render( $term ): void {
		if ( ! $term instanceof WP_Term ) {
			return;
		}

		echo self::notice( $term->term_id ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- notice() escapes every value it prints.
	}

	/**
	 * The notice's HTML, or an empty string when nothing is recorded.
	 *
	 * @param int      $term_id The term.
	 * @param int|null $now     Unix time for the stale check and the relative time; null means now.
	 */
	public static function notice( int $term_id, ?int $now = null ): string {
		$record = ResultStore::read_term( $term_id );

		if ( null === $record ) {
			return '';
		}

		$when = ResultText::relative_time( $record, $now );
		$text = ResultText::sentence( $record, $now );

		if ( '' !== $when ) {
			/* translators: 1: the result sentence, 2: how long ago, such as "5 mins ago". */
			$text = sprintf( __( '%1$s (%2$s)', 'resource-hub' ), $text, $when );
		}

		return '<div class="notice notice-' . esc_attr( ResultText::level( $record ) ) . ' inline"><p><strong>' . esc_html__( 'Front-end revalidation:', 'resource-hub' ) . '</strong> ' . esc_html( $text ) . '</p></div>';
	}
}
