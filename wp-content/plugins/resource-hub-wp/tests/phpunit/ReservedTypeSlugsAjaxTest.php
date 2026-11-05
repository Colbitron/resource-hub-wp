<?php
/**
 * Quick Edit on the Types screen refuses a reserved slug (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\ReservedTypeSlugs;
use ResourceHub\ContentModel\Taxonomies;
use WP_Ajax_UnitTestCase;
use WPAjaxDieStopException;

/**
 * Runs the real `inline-save-tax` AJAX action, with core's handler behind the plugin's.
 */
final class ReservedTypeSlugsAjaxTest extends WP_Ajax_UnitTestCase {
	/**
	 * Loads core's AJAX handlers and the admin includes the Quick Edit handler uses to print the
	 * updated row.
	 */
	public static function set_up_before_class(): void {
		require_once ABSPATH . 'wp-admin/includes/admin.php';
		require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

		parent::set_up_before_class();
	}

	/**
	 * Registers core's Quick Edit handler at its usual priority, behind the plugin's. The parent
	 * registers it once per class, but the base test case restores the hooks it saved before this
	 * class ran after every test, so it is registered per test here.
	 */
	public function set_up(): void {
		parent::set_up();
		add_action( 'wp_ajax_inline-save-tax', 'wp_ajax_inline_save_tax', 1 );
	}

	/**
	 * A reserved slug, typed or generated from the name, ends the request with the message and
	 * leaves the type unchanged.
	 *
	 * @dataProvider refused_cases
	 *
	 * @param string $name Name field.
	 * @param string $slug Slug field.
	 * @param string $reserved The reserved slug.
	 */
	public function test_quick_edit_is_refused( string $name, string $slug, string $reserved ): void {
		$term_id = $this->quick_edit( $name, $slug );

		try {
			$this->_handleAjax( 'inline-save-tax' );
			$this->fail( 'Quick Edit was not refused.' );
		} catch ( WPAjaxDieStopException $refusal ) {
			$this->assertSame( esc_html( ReservedTypeSlugs::message( $reserved ) ), $refusal->getMessage() );
		}

		$this->assertSame( 'webinar', get_term( $term_id )->slug );
		$this->assertSame( 'Webinar', get_term( $term_id )->name );
	}

	/**
	 * Cases for test_quick_edit_is_refused().
	 *
	 * @return array<string, array{0: string, 1: string, 2: string}>
	 */
	public function refused_cases(): array {
		return array(
			'slug page'              => array( 'Webinar', 'page', 'page' ),
			'empty slug, name Topic' => array( 'Topic', '', 'topic' ),
		);
	}

	/**
	 * An allowed slug goes through to core, which saves it and answers with the updated row.
	 */
	public function test_quick_edit_with_allowed_slug_saves(): void {
		$term_id = $this->quick_edit( 'Webinars', 'webinars' );

		try {
			$this->_handleAjax( 'inline-save-tax' );
		} catch ( WPAjaxDieStopException $stop ) {
			$this->fail( 'Quick Edit stopped with: ' . $stop->getMessage() );
		} catch ( \WPAjaxDieContinueException $done ) {
			unset( $done );
		}

		$this->assertSame( 'webinars', get_term( $term_id )->slug );
		$this->assertStringContainsString( '<tr', $this->_last_response );
	}

	/**
	 * Someone who may not edit types gets core's own refusal, not the slug message, and nothing
	 * changes.
	 */
	public function test_quick_edit_checks_permission_first(): void {
		$term_id = $this->quick_edit( 'Topic', '', 'author' );

		try {
			$this->_handleAjax( 'inline-save-tax' );
			$this->fail( 'Quick Edit was not refused.' );
		} catch ( WPAjaxDieStopException $refusal ) {
			$this->assertSame( '-1', $refusal->getMessage() );
		}

		$this->assertSame( 'webinar', get_term( $term_id )->slug );
	}

	/**
	 * Logs in a user, an administrator by default, creates the Webinar type and fills the Quick
	 * Edit request for it.
	 *
	 * @param string $name Name field.
	 * @param string $slug Slug field.
	 * @param string $role Role of the user sending it.
	 * @return int The type's term ID.
	 */
	private function quick_edit( string $name, string $slug, string $role = 'administrator' ): int {
		$this->_setRole( $role );

		$created = wp_insert_term( 'Webinar', Taxonomies::TYPE, array( 'slug' => 'webinar' ) );
		$this->assertIsArray( $created );
		$term_id = (int) $created['term_id'];

		$_POST = array(
			'action'       => 'inline-save-tax',
			'_inline_edit' => wp_create_nonce( 'taxinlineeditnonce' ),
			'taxonomy'     => Taxonomies::TYPE,
			'tax_type'     => 'tag',
			'tax_ID'       => (string) $term_id,
			'name'         => $name,
			'slug'         => $slug,
		);

		return $term_id;
	}
}
