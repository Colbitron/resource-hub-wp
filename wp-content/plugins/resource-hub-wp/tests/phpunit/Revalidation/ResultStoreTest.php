<?php
/**
 * The result store: the meta it writes and the REST field that exposes it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use ResourceHub\Revalidation\TermEvents;
use ResourceHub\Revalidation\ResourceEvents;
use ResourceHub\Revalidation\ResourceState;
use WP_REST_Request;

/**
 * Tests for {@see ResultStore} (ADR 0018).
 */
final class ResultStoreTest extends RevalidationTestCase {
	/**
	 * A batch of events for two resources and one term, all of which exist.
	 *
	 * @return array{0: array<int, array<string, mixed>>, 1: int, 2: int, 3: int}
	 */
	private function batch(): array {
		$first  = $this->make_resource( 'publish', 'first' );
		$second = $this->make_resource( 'publish', 'second' );
		$topic  = $this->make_term( Taxonomies::TOPIC, 'performance', 'Performance' );

		$events = array(
			ResourceEvents::event( 'update', $first, ResourceState::of_post( get_post( $first ) ), ResourceState::of_post( get_post( $first ) ) ),
			ResourceEvents::event( 'trash', $second, ResourceState::of_post( get_post( $second ) ), null ),
			TermEvents::event( 'create', get_term( $topic ), null ),
		);

		return array( $events, $first, $second, $topic );
	}

	/**
	 * `mark_pending()` writes a `pending` record to every object; `record()` then overwrites it with the result,
	 * each copy carrying its own event and the count of the other changes in the batch.
	 */
	public function test_pending_then_recorded_on_every_object(): void {
		list( $events, $first, $second, $topic ) = $this->batch();
		$store                                   = new ResultStore();

		$store->mark_pending( 'batch-1', $events );

		$pending = ResultStore::read_post( $first );
		$this->assertSame( ResultStore::PENDING, $pending['status'] );
		$this->assertSame( ResultStore::PENDING, $pending['outcome'] );
		$this->assertNull( $pending['code'] );
		$this->assertSame( 'update', $pending['event'] );
		$this->assertSame( 'batch-1', $pending['batch_id'] );
		$this->assertSame( 2, $pending['others'] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_post( $second )['status'] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_term( $topic )['status'] );

		$store->record( 'batch-1', $events, new Result( Result::SENT, Result::OK, 200, '{"revalidated":["/resources/"]}', null, 42 ) );

		$record = ResultStore::read_post( $first );
		$this->assertSame(
			array( 'status', 'outcome', 'code', 'event', 'time', 'batch_id', 'others', 'body', 'error', 'duration_ms' ),
			array_keys( $record )
		);
		$this->assertSame( Result::SENT, $record['status'] );
		$this->assertSame( Result::OK, $record['outcome'] );
		$this->assertSame( 200, $record['code'] );
		$this->assertSame( 'update', $record['event'] );
		$this->assertMatchesRegularExpression( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $record['time'] );
		$this->assertSame( 'batch-1', $record['batch_id'] );
		$this->assertSame( 2, $record['others'] );
		$this->assertSame( '{"revalidated":["/resources/"]}', $record['body'] );
		$this->assertNull( $record['error'] );
		$this->assertSame( 42, $record['duration_ms'] );

		$this->assertSame( 'trash', ResultStore::read_post( $second )['event'] );
		$this->assertSame( 'create', ResultStore::read_term( $topic )['event'] );
		$this->assertSame( Result::SENT, ResultStore::read_term( $topic )['status'] );
	}

	/**
	 * A failure is stored with its code, body and error.
	 */
	public function test_failure_is_stored(): void {
		list( $events, $first ) = $this->batch();

		( new ResultStore() )->record( 'batch-2', $events, new Result( Result::FAILED, Result::TIMEOUT, null, '', 'cURL error 28: timed out', 3001 ) );

		$record = ResultStore::read_post( $first );
		$this->assertSame( Result::FAILED, $record['status'] );
		$this->assertSame( Result::TIMEOUT, $record['outcome'] );
		$this->assertNull( $record['code'] );
		$this->assertSame( 'cURL error 28: timed out', $record['error'] );
	}

	/**
	 * A deleted post or term gets no meta: nothing is written for an object that no longer exists, and
	 * no orphan meta row appears.
	 */
	public function test_deleted_objects_get_no_meta(): void {
		list( $events, $first, $second, $topic ) = $this->batch();

		wp_delete_post( $second, true );
		wp_delete_term( $topic, Taxonomies::TOPIC );
		$this->queue->clear();

		( new ResultStore() )->record( 'batch-3', $events, Result::not_configured() );

		$this->assertSame( Result::NOT_CONFIGURED, ResultStore::read_post( $first )['outcome'] );
		$this->assertSame( '', get_post_meta( $second, ResultStore::META_KEY, true ) );
		$this->assertSame( '', get_term_meta( $topic, ResultStore::META_KEY, true ) );
	}

	/**
	 * Meta is only ever written to resources, never to another post type that happens to share the ID.
	 */
	public function test_other_post_types_get_no_meta(): void {
		$page  = self::factory()->post->create( array( 'post_type' => 'page' ) );
		$event = ResourceEvents::event(
			'publish',
			$page,
			array(
				'slug'   => 'page',
				'types'  => array( 'x' ),
				'topics' => array(),
			),
			null
		);

		( new ResultStore() )->record( 'batch-4', array( $event ), Result::not_configured() );

		$this->assertSame( '', get_post_meta( $page, ResultStore::META_KEY, true ) );
	}

	/**
	 * The REST field is in the `edit` context only: present for an editor reading with `context=edit`,
	 * absent from `view`, and absent from the public collection.
	 */
	public function test_rest_field_is_edit_context_only(): void {
		list( $events, $first ) = $this->batch();
		( new ResultStore() )->record( 'batch-5', $events, new Result( Result::SENT, Result::OK, 200, '{"revalidated":[]}', null, 10 ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$edit = new WP_REST_Request( 'GET', '/wp/v2/resources/' . $first );
		$edit->set_param( 'context', 'edit' );
		$edit_data = rest_get_server()->dispatch( $edit )->get_data();

		$this->assertArrayHasKey( ResultStore::REST_FIELD, $edit_data );
		$this->assertSame( Result::SENT, $edit_data[ ResultStore::REST_FIELD ]['status'] );
		$this->assertSame( 'batch-5', $edit_data[ ResultStore::REST_FIELD ]['batch_id'] );

		$view_data = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/resources/' . $first ) )->get_data();
		$this->assertArrayNotHasKey( ResultStore::REST_FIELD, $view_data );

		wp_set_current_user( 0 );
		$public = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/resources' ) )->get_data();
		foreach ( $public as $item ) {
			$this->assertArrayNotHasKey( ResultStore::REST_FIELD, $item );
		}
	}

	/**
	 * The field's schema declares it read-only and `edit`-only, and the field has no update callback.
	 */
	public function test_rest_field_is_read_only(): void {
		global $wp_rest_additional_fields;

		rest_get_server();

		$this->assertArrayHasKey( ResultStore::REST_FIELD, $wp_rest_additional_fields['resource'] );

		$field = $wp_rest_additional_fields['resource'][ ResultStore::REST_FIELD ];
		$this->assertNull( $field['update_callback'] );
		$this->assertTrue( $field['schema']['readonly'] );
		$this->assertSame( array( 'edit' ), $field['schema']['context'] );

		foreach ( TermEvents::TAXONOMIES as $taxonomy ) {
			$this->assertArrayHasKey( ResultStore::REST_FIELD, $wp_rest_additional_fields[ $taxonomy ] );
		}
	}

	/**
	 * The callbacks return null outside the `edit` context and for a user who cannot edit the object.
	 */
	public function test_rest_callbacks_check_context_and_capability(): void {
		list( $events, $first, , $topic ) = $this->batch();
		$store                            = new ResultStore();
		$store->record( 'batch-6', $events, Result::not_configured() );

		$edit = new WP_REST_Request( 'GET', '/wp/v2/resources/' . $first );
		$edit->set_param( 'context', 'edit' );
		$view = new WP_REST_Request( 'GET', '/wp/v2/resources/' . $first );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertNotNull( $store->rest_post_value( array( 'id' => $first ), ResultStore::REST_FIELD, $edit ) );
		$this->assertNull( $store->rest_post_value( array( 'id' => $first ), ResultStore::REST_FIELD, $view ) );
		$this->assertNotNull( $store->rest_term_value( array( 'id' => $topic ), ResultStore::REST_FIELD, $edit ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertNull( $store->rest_post_value( array( 'id' => $first ), ResultStore::REST_FIELD, $edit ) );
		$this->assertNull( $store->rest_term_value( array( 'id' => $topic ), ResultStore::REST_FIELD, $edit ) );
	}

	/**
	 * The term field reads term meta over REST in the `edit` context.
	 */
	public function test_term_rest_field(): void {
		list( $events, , , $topic ) = $this->batch();
		( new ResultStore() )->record( 'batch-7', $events, Result::not_configured() );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$request = new WP_REST_Request( 'GET', '/wp/v2/' . Taxonomies::TOPIC . '/' . $topic );
		$request->set_param( 'context', 'edit' );
		$data = rest_get_server()->dispatch( $request )->get_data();

		$this->assertSame( 'create', $data[ ResultStore::REST_FIELD ]['event'] );
		$this->assertSame( Result::NOT_CONFIGURED, $data[ ResultStore::REST_FIELD ]['outcome'] );
	}
}
