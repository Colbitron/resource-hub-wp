<?php
/**
 * Quick Edit cannot leave a public resource without a title, a topic or a summary.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\RequiredFields;
use ResourceHub\ContentModel\Taxonomies;
use WP_Ajax_UnitTestCase;
use WPAjaxDieContinueException;
use WPAjaxDieStopException;

/**
 * Runs the real `inline-save` AJAX action with core's handler behind the plugin's, as
 * OneTypeAdminTest does for the type rule.
 */
final class RequiredFieldsAdminTest extends WP_Ajax_UnitTestCase {
	/**
	 * A type term ID, created per test.
	 *
	 * @var int
	 */
	private int $type_id;

	/**
	 * A topic term, created per test.
	 *
	 * @var \WP_Term
	 */
	private \WP_Term $topic;

	/**
	 * Loads core's AJAX handlers and the admin includes Quick Edit uses.
	 */
	public static function set_up_before_class(): void {
		require_once ABSPATH . 'wp-admin/includes/admin.php';
		require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';

		parent::set_up_before_class();
	}

	/**
	 * Registers core's Quick Edit handler at its usual priority, behind the plugin's, logs in an
	 * editor and creates a type and a topic.
	 */
	public function set_up(): void {
		parent::set_up();
		add_action( 'wp_ajax_inline-save', 'wp_ajax_inline_save', 1 );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$this->topic   = self::factory()->term->create_and_get( array( 'taxonomy' => Taxonomies::TOPIC ) );
	}

	/**
	 * Publishing a draft through Quick Edit is refused while a field is blank in the row or
	 * missing in storage, with the message naming what is missing, and nothing is written.
	 *
	 * @dataProvider incomplete_drafts
	 *
	 * @param array<string, string> $fields  Fields of the row that differ from the stored draft.
	 * @param string[]              $missing The fields the message names.
	 * @param bool                  $stored  Whether the draft has a topic and a summary stored.
	 */
	public function test_quick_edit_does_not_publish_an_incomplete_draft( array $fields, array $missing, bool $stored ): void {
		$post_id = $this->draft( $stored );

		$this->quick_edit( $post_id, $fields + array( '_status' => 'publish' ) );

		try {
			$this->_handleAjax( 'inline-save' );
			$this->fail( 'Quick Edit was not refused.' );
		} catch ( WPAjaxDieStopException $refusal ) {
			$this->assertSame( RequiredFields::admin_message( $missing ), $refusal->getMessage() );
		}

		$this->assertSame( 'draft', get_post_status( $post_id ) );
		$this->assertSame( 'A draft', get_post( $post_id )->post_title );
	}

	/**
	 * Cases for test_quick_edit_does_not_publish_an_incomplete_draft().
	 *
	 * @return array<string, array{0: array<string, string>, 1: string[], 2: bool}>
	 */
	public function incomplete_drafts(): array {
		return array(
			'blank title in the row'      => array( array( 'post_title' => ' &nbsp; ' ), array( 'title' ), true ),
			'topics cleared in the row'   => array( array( 'tax_input' => array( Taxonomies::TOPIC => '' ) ), array( 'topic' ), true ),
			'no topic or summary stored'  => array( array(), array( 'topic', 'summary' ), false ),
			'topic typed, summary absent' => array( array( 'tax_input' => array( Taxonomies::TOPIC => 'A new topic' ) ), array( 'summary' ), false ),
		);
	}

	/**
	 * The refusal names every missing field as a list.
	 */
	public function test_admin_message_lists_the_missing_fields(): void {
		$this->assertSame(
			'A resource needs a title to be published or scheduled. Edit it to add what is missing.',
			RequiredFields::admin_message( array( 'title' ) )
		);
		$this->assertSame(
			'A resource needs a title, at least one topic, and a summary to be published or scheduled. Edit it to add what is missing.',
			RequiredFields::admin_message( RequiredFields::FIELDS )
		);
	}

	/**
	 * A complete draft publishes through Quick Edit, with a topic typed in the row counting as
	 * much as a stored one, and core answers with the updated row.
	 */
	public function test_quick_edit_publishes_a_complete_draft(): void {
		$stored = $this->draft( true );

		$this->quick_edit( $stored, array( '_status' => 'publish' ) );
		$this->handle_quick_edit_save();

		$this->assertSame( 'publish', get_post_status( $stored ) );
		$this->assertStringContainsString( '<tr', $this->_last_response );

		$typed = $this->draft( false );
		update_post_meta( $typed, Meta::SUMMARY, 'A summary' );

		$this->quick_edit(
			$typed,
			array(
				'_status'   => 'publish',
				'tax_input' => array( Taxonomies::TOPIC => $this->topic->name ),
			)
		);
		$this->handle_quick_edit_save();

		$this->assertSame( 'publish', get_post_status( $typed ) );
		$this->assertSame( array( $this->topic->term_id ), wp_get_object_terms( $typed, Taxonomies::TOPIC, array( 'fields' => 'ids' ) ) );
	}

	/**
	 * A published resource cannot have its title blanked or its topics cleared from the row.
	 *
	 * @dataProvider published_edits
	 *
	 * @param array<string, string> $fields  Fields of the row that differ from the stored resource.
	 * @param string[]              $missing The fields the message names.
	 */
	public function test_quick_edit_keeps_a_published_resource_whole( array $fields, array $missing ): void {
		$post_id = $this->published();

		$this->quick_edit( $post_id, $fields );

		try {
			$this->_handleAjax( 'inline-save' );
			$this->fail( 'Quick Edit was not refused.' );
		} catch ( WPAjaxDieStopException $refusal ) {
			$this->assertSame( RequiredFields::admin_message( $missing ), $refusal->getMessage() );
		}

		$this->assertSame( 'Published', get_post( $post_id )->post_title );
		$this->assertSame( array( $this->topic->term_id ), wp_get_object_terms( $post_id, Taxonomies::TOPIC, array( 'fields' => 'ids' ) ) );
	}

	/**
	 * Cases for test_quick_edit_keeps_a_published_resource_whole().
	 *
	 * @return array<string, array{0: array<string, string>, 1: string[]}>
	 */
	public function published_edits(): array {
		return array(
			'title blanked'  => array( array( 'post_title' => '<em></em>' ), array( 'title' ) ),
			'topics cleared' => array( array( 'tax_input' => array( Taxonomies::TOPIC => '' ) ), array( 'topic' ) ),
		);
	}

	/**
	 * A published resource that keeps its fields saves through Quick Edit as usual.
	 */
	public function test_quick_edit_of_a_complete_published_resource_saves(): void {
		$post_id = $this->published();

		$this->quick_edit( $post_id, array( 'post_title' => 'Retitled' ) );
		$this->handle_quick_edit_save();

		$this->assertSame( 'Retitled', get_post( $post_id )->post_title );
		$this->assertSame( 'publish', get_post_status( $post_id ) );
	}

	/**
	 * A draft that stays a draft saves whatever it lacks.
	 */
	public function test_quick_edit_of_a_draft_that_stays_a_draft_saves(): void {
		$post_id = $this->draft( false );

		$this->quick_edit( $post_id, array( 'post_title' => '' ) );
		$this->handle_quick_edit_save();

		$this->assertSame( '', get_post( $post_id )->post_title );
		$this->assertSame( 'draft', get_post_status( $post_id ) );
	}

	/**
	 * A draft resource with a type, titled "A draft", with a topic and a summary when asked.
	 *
	 * @param bool $complete Whether to store a topic and a summary too.
	 */
	private function draft( bool $complete ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'draft',
				'post_title'  => 'A draft',
			)
		);
		wp_set_object_terms( $post_id, $this->type_id, Taxonomies::TYPE );

		if ( $complete ) {
			wp_set_object_terms( $post_id, $this->topic->term_id, Taxonomies::TOPIC );
			update_post_meta( $post_id, Meta::SUMMARY, 'A summary' );
		}

		return $post_id;
	}

	/**
	 * A published resource with every required field, titled "Published".
	 */
	private function published(): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_title'  => 'Published',
			)
		);
		wp_set_object_terms( $post_id, $this->type_id, Taxonomies::TYPE );
		wp_set_object_terms( $post_id, $this->topic->term_id, Taxonomies::TOPIC );
		update_post_meta( $post_id, Meta::SUMMARY, 'A summary' );

		return $post_id;
	}

	/**
	 * Fills `$_POST` as the Resources list's Quick Edit row posts it, with the stored topics in
	 * the row unless the fields say otherwise.
	 *
	 * @param int                  $post_id Resource ID.
	 * @param array<string, mixed> $fields  Fields that differ from the stored post.
	 */
	private function quick_edit( int $post_id, array $fields ): void {
		$post   = get_post( $post_id );
		$topics = wp_get_object_terms( $post_id, Taxonomies::TOPIC, array( 'fields' => 'names' ) );

		$_POST = $fields + array(
			'_inline_edit' => wp_create_nonce( 'inlineeditnonce' ),
			'post_ID'      => (string) $post_id,
			'post_type'    => PostType::NAME,
			'post_title'   => $post->post_title,
			'post_name'    => $post->post_name,
			'post_author'  => (string) $post->post_author,
			'_status'      => $post->post_status,
			'tax_input'    => array( Taxonomies::TOPIC => implode( ',', is_array( $topics ) ? $topics : array() ) ),
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
}
