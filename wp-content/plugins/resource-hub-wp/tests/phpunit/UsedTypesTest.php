<?php
/**
 * A type that resources still have cannot be deleted (ADR 0024).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\ContentModel\UsedTypes;
use RuntimeException;
use WPDieException;
use WP_REST_Request;
use WP_REST_Response;
use WP_Term;
use WP_UnitTestCase;

/**
 * `delete_term` on a used type, through the capability and over REST, and the Types screen's bulk
 * delete.
 */
final class UsedTypesTest extends WP_UnitTestCase {
	/**
	 * Logs in an administrator, who could delete any type that is not in use.
	 */
	public function set_up(): void {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	/**
	 * Clears the form globals the bulk-delete tests set.
	 */
	public function tear_down(): void {
		$_POST    = array();
		$_REQUEST = array();
		$_GET     = array();
		parent::tear_down();
	}

	/**
	 * Deleting a type over REST: refused with a plain message while a resource has it in any status
	 * but trash; allowed once nothing does.
	 *
	 * @dataProvider status_cases
	 *
	 * @param string $status  Status of the resource that has the type.
	 * @param bool   $refused Whether the delete is refused.
	 */
	public function test_rest_delete( string $status, bool $refused ): void {
		$type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'trash' === $status ? 'publish' : $status,
			)
		);
		wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );

		if ( 'trash' === $status ) {
			wp_trash_post( $post_id );
		}

		$response = $this->delete( $type_id );

		if ( $refused ) {
			$this->assertSame( 403, $response->get_status() );
			$this->assertSame( UsedTypes::ERROR_CODE, $response->get_data()['code'] );
			$this->assertSame( 'This type cannot be deleted while resources have it. Give those resources another type first.', $response->get_data()['message'] );
			$this->assertInstanceOf( WP_Term::class, get_term( $type_id, Taxonomies::TYPE ) );
			$this->assertFalse( current_user_can( 'delete_term', $type_id ) );
			return;
		}

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_term( $type_id, Taxonomies::TYPE ) );
	}

	/**
	 * Cases for test_rest_delete().
	 *
	 * @return array<string, array{0: string, 1: bool}>
	 */
	public function status_cases(): array {
		return array(
			'published' => array( 'publish', true ),
			'draft'     => array( 'draft', true ),
			'private'   => array( 'private', true ),
			'trashed'   => array( 'trash', false ),
		);
	}

	/**
	 * A type no resource has can be deleted, and the capability allows it.
	 */
	public function test_unused_type_can_be_deleted(): void {
		$type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );

		$this->assertTrue( current_user_can( 'delete_term', $type_id ) );

		$response = $this->delete( $type_id );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( get_term( $type_id, Taxonomies::TYPE ) );
	}

	/**
	 * Someone who may not delete types at all keeps core's own answer.
	 */
	public function test_user_without_the_capability_gets_cores_answer(): void {
		$type_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$post_id = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		$response = $this->delete( $type_id );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'rest_cannot_delete', $response->get_data()['code'] );
	}

	/**
	 * Other taxonomies are untouched: a topic resources have can still be deleted.
	 */
	public function test_other_taxonomies_are_untouched(): void {
		$topic_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$post_id  = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		wp_set_object_terms( $post_id, $topic_id, Taxonomies::TOPIC );

		$this->assertTrue( current_user_can( 'delete_term', $topic_id ) );
	}

	/**
	 * A bulk delete that selects one used type among unused ones is refused: the editor is sent back
	 * to the list with the error notice naming the used type, and no selected type is deleted.
	 */
	public function test_bulk_delete_with_a_used_type_is_refused(): void {
		$unused_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$used_id   = $this->used_type( 'Webinar' );
		$back      = admin_url( 'edit-tags.php?taxonomy=' . Taxonomies::TYPE . '&post_type=' . PostType::NAME );

		$this->post_bulk_delete( array( $unused_id, $used_id ), $back );

		$location = $this->redirect_of( array( new UsedTypes(), 'refuse_bulk_delete' ) );

		$expected = add_query_arg(
			array(
				'error'              => 1,
				'message'            => UsedTypes::ADMIN_MESSAGE,
				UsedTypes::ADMIN_ARG => (string) $used_id,
			),
			$back
		);
		$this->assertSame( $expected, $location );
		$this->assertInstanceOf( WP_Term::class, get_term( $unused_id, Taxonomies::TYPE ) );
		$this->assertInstanceOf( WP_Term::class, get_term( $used_id, Taxonomies::TYPE ) );
	}

	/**
	 * The bottom bulk selector is copied into `action` in the browser, so a request core reads as
	 * a bulk delete, here the literal `bulk-delete`, is refused the same way.
	 */
	public function test_literal_bulk_delete_action_is_refused(): void {
		$used_id = $this->used_type( 'Webinar' );

		$this->post_bulk_delete( array( $used_id ), admin_url( 'edit-tags.php' ), 'bulk-delete' );

		$this->assertNotNull( $this->redirect_of( array( new UsedTypes(), 'refuse_bulk_delete' ) ) );
	}

	/**
	 * A bulk delete of types no resource has is left to core: the handler neither redirects nor
	 * deletes, and core then deletes each type, which the capability allows.
	 */
	public function test_bulk_delete_of_unused_types_goes_through(): void {
		$ids = self::factory()->term->create_many( 2, array( 'taxonomy' => Taxonomies::TYPE ) );

		$this->post_bulk_delete( $ids, admin_url( 'edit-tags.php' ) );

		$this->assertNull( $this->redirect_of( array( new UsedTypes(), 'refuse_bulk_delete' ) ) );

		foreach ( $ids as $term_id ) {
			$this->assertTrue( current_user_can( 'delete_term', $term_id ) );
			$this->assertTrue( wp_delete_term( $term_id, Taxonomies::TYPE ) );
		}
	}

	/**
	 * Someone who may not delete types is left to core's own refusal: the handler neither checks
	 * the nonce nor redirects.
	 */
	public function test_bulk_delete_checks_permission_first(): void {
		$used_id = $this->used_type( 'Webinar' );
		$this->post_bulk_delete( array( $used_id ), admin_url( 'edit-tags.php' ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );

		$this->assertNull( $this->redirect_of( array( new UsedTypes(), 'refuse_bulk_delete' ) ) );
		$this->assertInstanceOf( WP_Term::class, get_term( $used_id, Taxonomies::TYPE ) );
	}

	/**
	 * A user who may delete types but sends no valid nonce is stopped by the nonce check.
	 */
	public function test_bulk_delete_checks_the_nonce(): void {
		$used_id = $this->used_type( 'Webinar' );
		$this->post_bulk_delete( array( $used_id ), admin_url( 'edit-tags.php' ) );
		$_REQUEST['_wpnonce'] = 'invalid';

		$this->expectException( WPDieException::class );

		( new UsedTypes() )->refuse_bulk_delete();
	}

	/**
	 * Other taxonomies' bulk deletes are left to core.
	 */
	public function test_bulk_delete_of_other_taxonomies_is_left_alone(): void {
		$topic_id = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TOPIC ) );
		$this->post_bulk_delete( array( $topic_id ), admin_url( 'edit-tags.php' ) );
		$_REQUEST['taxonomy'] = Taxonomies::TOPIC;

		$this->assertNull( $this->redirect_of( array( new UsedTypes(), 'refuse_bulk_delete' ) ) );
	}

	/**
	 * The notice names the types in use, escaped, keeps core's messages, and ignores IDs in the
	 * link that are not types in use.
	 */
	public function test_admin_messages_name_the_types_in_use(): void {
		$used_id                      = $this->used_type( 'Q&A <em>sessions</em>' );
		$unused_id                    = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => 'Unused type',
			)
		);
		$_GET[ UsedTypes::ADMIN_ARG ] = $used_id . ',' . $unused_id;

		$messages = ( new UsedTypes() )->admin_messages(
			array(
				'_item' => array( 6 => 'Items deleted.' ),
			)
		);
		$message  = $messages[ Taxonomies::TYPE ][ UsedTypes::ADMIN_MESSAGE ];

		$this->assertSame( 'Items deleted.', $messages[ Taxonomies::TYPE ][6] );
		$this->assertSame( 'Types not deleted. Resources still have the type Q&amp;A sessions. Give those resources another type first.', $message );
	}

	/**
	 * With no type in use named in the link, no refusal message is added.
	 */
	public function test_admin_messages_without_types_in_use(): void {
		$unused_id                    = self::factory()->term->create( array( 'taxonomy' => Taxonomies::TYPE ) );
		$_GET[ UsedTypes::ADMIN_ARG ] = (string) $unused_id;

		$messages = ( new UsedTypes() )->admin_messages( array() );

		$this->assertArrayNotHasKey( Taxonomies::TYPE, $messages );
	}

	/**
	 * Creates a type that a published resource has and returns its ID.
	 *
	 * @param string $name Name.
	 */
	private function used_type( string $name ): int {
		$type_id = self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'name'     => $name,
			)
		);
		$post_id = self::factory()->post->create( array( 'post_type' => PostType::NAME ) );
		wp_set_object_terms( $post_id, $type_id, Taxonomies::TYPE );

		return $type_id;
	}

	/**
	 * Fills the globals the Types screen's bulk-action form posts for a delete.
	 *
	 * @param int[]  $term_ids Selected type IDs.
	 * @param string $back     The page the form was on.
	 * @param string $action   The bulk action as posted.
	 */
	private function post_bulk_delete( array $term_ids, string $back, string $action = 'delete' ): void {
		$form = array(
			'action'           => $action,
			'action2'          => '-1',
			'taxonomy'         => Taxonomies::TYPE,
			'post_type'        => PostType::NAME,
			'delete_tags'      => array_map( 'strval', $term_ids ),
			'_wpnonce'         => wp_create_nonce( 'bulk-tags' ),
			'_wp_http_referer' => $back,
		);

		$_POST    = $form;
		$_REQUEST = $form;
	}

	/**
	 * Runs a handler and returns where it redirected, or null if it returned without redirecting.
	 * The redirect is caught at the `wp_redirect` filter, before any header or exit.
	 *
	 * @param callable $handler The handler.
	 */
	private function redirect_of( callable $handler ): ?string {
		$location = null;
		$catch    = static function ( string $to ) use ( &$location ): string {
			$location = $to;
			throw new RuntimeException( 'Redirected.' );
		};
		add_filter( 'wp_redirect', $catch );

		try {
			$handler();
		} catch ( RuntimeException $redirect ) {
			unset( $redirect );
		} finally {
			remove_filter( 'wp_redirect', $catch );
		}

		return $location;
	}

	/**
	 * Sends a forced REST delete of a type, as the Types API takes it.
	 *
	 * @param int $type_id Type term ID.
	 */
	private function delete( int $type_id ): WP_REST_Response {
		$request = new WP_REST_Request( 'DELETE', '/wp/v2/' . Taxonomies::TYPE . '/' . $type_id );
		$request->set_param( 'force', true );

		return rest_get_server()->dispatch( $request );
	}
}
