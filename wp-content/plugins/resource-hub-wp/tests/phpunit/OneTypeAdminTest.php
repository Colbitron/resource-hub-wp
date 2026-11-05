<?php
/**
 * Quick Edit and Bulk Edit cannot publish a resource without exactly one type (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\OneType;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Ajax_UnitTestCase;
use WPAjaxDieContinueException;
use WPAjaxDieStopException;

/**
 * Runs the real `inline-save` AJAX action, with core's handler behind the plugin's, and core's
 * `bulk_edit_posts()` behind the plugin's `load-edit.php` guard.
 */
final class OneTypeAdminTest extends WP_Ajax_UnitTestCase {
	/**
	 * A type term ID, created per test.
	 *
	 * @var int
	 */
	private int $type_id;

	/**
	 * Loads core's AJAX handlers and the admin includes Quick Edit and Bulk Edit use.
	 */
	public static function set_up_before_class(): void {
		require_once ABSPATH . 'wp-admin/includes/admin.php';
		require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

		parent::set_up_before_class();
	}

	/**
	 * Registers core's Quick Edit handler at its usual priority, behind the plugin's (the base test
	 * case restores the hooks after every test), logs in an editor and creates a type.
	 */
	public function set_up(): void {
		parent::set_up();
		add_action( 'wp_ajax_inline-save', 'wp_ajax_inline_save', 1 );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
	}

	/**
	 * Clears the form globals the Bulk Edit tests set.
	 */
	public function tear_down(): void {
		$_REQUEST = array();
		$_GET     = array();
		parent::tear_down();
	}

	/**
	 * Quick Edit that would publish a draft with no type ends with the message and saves nothing:
	 * the status, and the title sent with it, stay as stored. The status is judged as core is about
	 * to write it, so the publish button's field counts as much as the status menu.
	 *
	 * @dataProvider publishing_fields
	 *
	 * @param array<string, string> $fields The fields that ask core to publish.
	 */
	public function test_quick_edit_does_not_publish_a_draft_without_a_type( array $fields ): void {
		$post_id = $this->draft( 0 );

		$this->quick_edit( $post_id, $fields + array( 'post_title' => 'Retitled' ) );

		try {
			$this->_handleAjax( 'inline-save' );
			$this->fail( 'Quick Edit was not refused.' );
		} catch ( WPAjaxDieStopException $refusal ) {
			$this->assertSame( 'A resource needs a type to be published or scheduled. Edit it to choose one.', $refusal->getMessage() );
		}

		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'A draft', get_post( $post_id )->post_title );
	}

	/**
	 * Cases for test_quick_edit_does_not_publish_a_draft_without_a_type().
	 *
	 * @return array<string, array{0: array<string, string>}>
	 */
	public function publishing_fields(): array {
		return array(
			'status menu'    => array( array( '_status' => 'publish' ) ),
			'publish button' => array(
				array(
					'_status' => 'draft',
					'publish' => 'Publish',
				),
			),
		);
	}

	/**
	 * A resource with more than one type, which only WP-CLI or PHP can make, is not published
	 * through Quick Edit either.
	 */
	public function test_quick_edit_does_not_publish_a_draft_with_two_types(): void {
		$post_id = $this->draft( 0 );
		wp_set_object_terms( $post_id, array( $this->type_id, self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) ) ), Taxonomies::TYPE );

		$this->quick_edit( $post_id, array( '_status' => 'publish' ) );

		$this->expectException( WPAjaxDieStopException::class );
		$this->_handleAjax( 'inline-save' );
	}

	/**
	 * Quick Edit publishes a draft that has one type, and answers with the updated row.
	 */
	public function test_quick_edit_publishes_a_draft_with_one_type(): void {
		$post_id = $this->draft( $this->type_id );

		$this->quick_edit( $post_id, array( '_status' => 'publish' ) );
		$this->handle_quick_edit_save();

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertStringContainsString( '<tr', $this->_last_response );
	}

	/**
	 * A resource already published with no type (possible only through WP-CLI or PHP) keeps its
	 * status through Quick Edit: the edit saves, it is neither unpublished nor given a type, so it
	 * is no worse than before, and the editor gives it a type.
	 */
	public function test_quick_edit_of_a_published_resource_without_a_type_saves(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Published',
			)
		);

		$this->quick_edit(
			$post_id,
			array(
				'_status'    => 'publish',
				'post_title' => 'Retitled',
			)
		);
		$this->handle_quick_edit_save();

		$this->assertSame( 'publish', get_post_status( $post_id ) );
		$this->assertSame( 'Retitled', get_post( $post_id )->post_title );
		$this->assertSame( array(), wp_get_object_terms( $post_id, Taxonomies::TYPE, array( 'fields' => 'ids' ) ) );
	}

	/**
	 * Quick Edit of a draft with no type that keeps it a draft saves as usual.
	 */
	public function test_quick_edit_of_a_draft_that_stays_a_draft_saves(): void {
		$post_id = $this->draft( 0 );

		$this->quick_edit(
			$post_id,
			array(
				'_status'    => 'draft',
				'post_title' => 'Retitled',
			)
		);
		$this->handle_quick_edit_save();

		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'Retitled', get_post( $post_id )->post_title );
	}

	/**
	 * Bulk Edit that publishes a draft with no type alongside one with a type publishes only the
	 * second: the first keeps its status, date and empty slug, and the redirect back to the list
	 * carries its ID to the notice.
	 */
	public function test_bulk_edit_publishes_only_drafts_with_one_type(): void {
		$typeless = $this->draft( 0 );
		$typed    = $this->draft( $this->type_id );
		$stored   = get_post( $typeless );

		$this->bulk_edit( array( $typeless, $typed ), array( '_status' => 'publish' ) );

		$this->assertSame( 'draft', get_post_status( $typeless ) );
		$this->assertSame( $stored->post_date, get_post( $typeless )->post_date );
		$this->assertSame( $stored->post_date_gmt, get_post( $typeless )->post_date_gmt );
		$this->assertSame( '', get_post( $typeless )->post_name );
		$this->assertSame( 'publish', get_post_status( $typed ) );

		$one_type = $this->plugin_one_type();
		$back     = admin_url( 'edit.php?post_type=' . PostType::NAME );
		$this->assertSame( 10, has_filter( 'wp_redirect', array( $one_type, 'bulk_edit_redirect' ) ) );
		$this->assertSame( add_query_arg( OneType::ADMIN_ARG, (string) $typeless, $back ), $one_type->bulk_edit_redirect( $back ) );
		$this->assertFalse( has_filter( 'wp_insert_post_data', array( $one_type, 'keep_status' ) ) );
	}

	/**
	 * Bulk Edit that publishes only drafts with a type leaves core's redirect alone.
	 */
	public function test_bulk_edit_with_nothing_refused_leaves_the_redirect_alone(): void {
		$typed = $this->draft( $this->type_id );

		$this->bulk_edit( array( $typed ), array( '_status' => 'publish' ) );

		$this->assertSame( 'publish', get_post_status( $typed ) );
		$this->assertFalse( has_filter( 'wp_redirect', array( $this->plugin_one_type(), 'bulk_edit_redirect' ) ) );
	}

	/**
	 * Bulk Edit cannot change the type: `resource_type` terms in a crafted request are dropped, as
	 * core's Quick Edit drops them, so a published resource keeps its one type.
	 */
	public function test_bulk_edit_does_not_change_the_type(): void {
		$other   = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
			)
		);
		wp_set_object_terms( $post_id, $this->type_id, Taxonomies::TYPE );

		$this->bulk_edit(
			array( $post_id ),
			array(
				'_status'   => '-1',
				'tax_input' => array( Taxonomies::TYPE => array( (string) $this->type_id, (string) $other ) ),
			)
		);

		$this->assertSame( array( $this->type_id ), wp_get_object_terms( $post_id, Taxonomies::TYPE, array( 'fields' => 'ids' ) ) );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * A Bulk Edit request without core's nonce is left to core, which refuses it: no guard is
	 * added.
	 */
	public function test_bulk_edit_without_the_nonce_is_left_to_core(): void {
		$_REQUEST = array(
			'bulk_edit' => 'Update',
			'post'      => array( '1' ),
			'_wpnonce'  => 'invalid',
			'tax_input' => array( Taxonomies::TYPE => array( '1' ) ),
		);

		$this->plugin_one_type()->guard_bulk_edit();

		$this->assertFalse( has_filter( 'wp_insert_post_data', array( $this->plugin_one_type(), 'keep_status' ) ) );
	}

	/**
	 * The seeder, WP-CLI and PHP callers are not guarded: outside Quick Edit and Bulk Edit, a
	 * resource can be inserted published and given its type afterwards.
	 */
	public function test_php_saves_are_not_guarded(): void {
		$post_id = wp_insert_post(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'From PHP',
			)
		);

		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * The notice names the resources Bulk Edit did not publish, escaped, and ignores IDs in the link
	 * that are not such resources.
	 */
	public function test_bulk_edit_notice_names_the_resources_not_published(): void {
		$typeless  = $this->draft( 0, 'Q&A <em>draft</em>' );
		$typed     = $this->draft( $this->type_id, 'Has a type' );
		$published = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Published',
			)
		);
		set_current_screen( 'edit-' . PostType::NAME );
		$_GET[ OneType::ADMIN_ARG ] = $typeless . ',' . $typed . ',' . $published;

		ob_start();
		( new OneType() )->bulk_edit_notice();
		$output = (string) ob_get_clean();

		$this->assertSame( '<div class="notice notice-error"><p>Not published or scheduled: Q&amp;A draft. A resource needs a type to be published or scheduled. Edit it to choose one.</p></div>', $output );
	}

	/**
	 * No notice on other screens, or when the link names no resource that was not published.
	 */
	public function test_bulk_edit_notice_is_quiet_otherwise(): void {
		$typed                      = $this->draft( $this->type_id );
		$_GET[ OneType::ADMIN_ARG ] = (string) $typed;

		set_current_screen( 'edit-' . PostType::NAME );
		ob_start();
		( new OneType() )->bulk_edit_notice();
		$this->assertSame( '', ob_get_clean() );

		$_GET[ OneType::ADMIN_ARG ] = (string) $this->draft( 0 );
		set_current_screen( 'edit-post' );
		ob_start();
		( new OneType() )->bulk_edit_notice();
		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * A draft resource, with the given type or none.
	 *
	 * @param int    $type_id Type term ID, or 0 for none.
	 * @param string $title   Title.
	 */
	private function draft( int $type_id, string $title = 'A draft' ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
				'post_title'  => $title,
			)
		);

		if ( $type_id ) {
			wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );
		}

		return $post_id;
	}

	/**
	 * Fills `$_POST` as the Resources list's Quick Edit row posts it.
	 *
	 * @param int                   $post_id Resource ID.
	 * @param array<string, string> $fields  Fields that differ from the stored post.
	 */
	private function quick_edit( int $post_id, array $fields ): void {
		$post = get_post( $post_id );

		$_POST = $fields + array(
			'_inline_edit' => wp_create_nonce( 'inlineeditnonce' ),
			'post_ID'      => (string) $post_id,
			'post_type'    => PostType::NAME,
			'post_title'   => $post->post_title,
			'post_name'    => $post->post_name,
			'post_author'  => (string) $post->post_author,
			'_status'      => $post->post_status,
			'screen'       => 'edit-' . PostType::NAME,
			'post_view'    => 'list',
		);
	}

	/**
	 * Runs a Quick Edit that core saves: core prints the row and ends the request.
	 */
	private function handle_quick_edit_save(): void {
		try {
			$this->_handleAjax( 'inline-save' );
		} catch ( WPAjaxDieContinueException $end ) {
			unset( $end );
		}
	}

	/**
	 * Runs a Bulk Edit as edit.php does: the plugin's `load-edit.php` guard, then core's handler
	 * with the request as the guard left it (`$_POST` here, which the guard treats as it does the
	 * `$_REQUEST` edit.php passes).
	 *
	 * @param int[]                $post_ids Selected resource IDs.
	 * @param array<string, mixed> $fields   Fields of the Bulk Edit form.
	 */
	private function bulk_edit( array $post_ids, array $fields ): void {
		$form = $fields + array(
			'action'         => 'edit',
			'bulk_edit'      => 'Update',
			'post_type'      => PostType::NAME,
			'post'           => array_map( 'strval', $post_ids ),
			'_wpnonce'       => wp_create_nonce( 'bulk-posts' ),
			'_status'        => '-1',
			'post_author'    => '-1',
			'comment_status' => '',
			'ping_status'    => '',
		);

		$_POST    = $form;
		$_REQUEST = $form;

		$this->plugin_one_type()->guard_bulk_edit();
		bulk_edit_posts();
	}

	/**
	 * The `OneType` instance the plugin registered, found through its Quick Edit hook.
	 */
	private function plugin_one_type(): OneType {
		global $wp_filter;

		foreach ( $wp_filter['wp_ajax_inline-save']->callbacks[0] as $callback ) {
			if ( is_array( $callback['function'] ) && $callback['function'][0] instanceof OneType ) {
				return $callback['function'][0];
			}
		}

		$this->fail( 'The plugin registered no OneType.' );
	}
}
