<?php
/**
 * The result store: the meta it writes and the REST field that exposes it.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Pages\PagePath;
use ResourceHub\Revalidation\PageEvents;
use ResourceHub\Revalidation\Payload;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use ResourceHub\Revalidation\TermEvents;
use ResourceHub\Revalidation\ResourceEvents;
use ResourceHub\Revalidation\ResourceState;
use ResourceHub\Revalidation\Sender;
use WP_REST_Request;

/**
 * Tests for {@see ResultStore} (see `docs/architecture/revalidation.md`).
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
		$this->assertFalse( $pending['truncated'] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_post( $second )['status'] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_term( $topic )['status'] );

		$store->record( 'batch-1', $events, new Result( Result::SENT, Result::OK, 200, '{"revalidated":["/resources/"]}', null, 42 ) );

		$record = ResultStore::read_post( $first );
		$this->assertSame(
			array( 'status', 'outcome', 'code', 'event', 'time', 'batch_id', 'others', 'body', 'truncated', 'error', 'duration_ms' ),
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
		$this->assertFalse( $record['truncated'] );
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
	 * A body with escaped quotes, a backslash path and a multibyte character is stored exactly, on a
	 * resource and on a term: core unslashes meta input, so the store slashes it first.
	 */
	public function test_body_with_backslashes_and_quotes_round_trips(): void {
		list( $events, $first, , $topic ) = $this->batch();
		$body                             = '{"error":"bad \\"slug\\" at C:\\temp\\x \\u00e9 é"}';

		( new ResultStore() )->record( 'batch-8', $events, new Result( Result::FAILED, Result::BAD_REQUEST, 400, $body, null, 5 ) );

		$this->assertSame( $body, ResultStore::read_post( $first )['body'] );
		$this->assertSame( $body, ResultStore::read_term( $topic )['body'] );
	}

	/**
	 * A result whose body was cut is stored with `truncated` true on every object in the batch, so the
	 * admin screens can say the reply was too long to show.
	 */
	public function test_truncated_flag_is_stored(): void {
		list( $events, $first, , $topic ) = $this->batch();
		$cut                              = '{"error":"' . str_repeat( 'x', Result::BODY_LIMIT - 10 );

		( new ResultStore() )->record( 'batch-14', $events, new Result( Result::FAILED, Result::SERVER_ERROR, 500, $cut, null, 5, true ) );

		$this->assertTrue( ResultStore::read_post( $first )['truncated'] );
		$this->assertTrue( ResultStore::read_term( $topic )['truncated'] );
	}

	/**
	 * A response body that is not valid UTF-8 still leaves a finished record, not `pending`: the sender
	 * makes it valid before it reaches meta.
	 */
	public function test_invalid_utf8_body_does_not_leave_the_record_pending(): void {
		list( $events, $first ) = $this->batch();
		$this->configure();
		$this->responder = static fn(): array => self::http_response( 500, "\xff\xfe bin \xc3" );
		$store           = new ResultStore();

		$store->mark_pending( 'batch-9', $events );
		$store->record( 'batch-9', $events, ( new Sender() )->send( Payload::build( $events ) ) );

		$record = ResultStore::read_post( $first );
		$this->assertSame( Result::FAILED, $record['status'] );
		$this->assertSame( Result::SERVER_ERROR, $record['outcome'] );
		$this->assertSame( 'batch-9', $record['batch_id'] );
		$this->assertTrue( wp_is_valid_utf8( $record['body'] ) );
	}

	/**
	 * When core will not store the record, it is stored again without its body and with a plain error,
	 * so the status never stays `pending`.
	 */
	public function test_record_that_cannot_be_written_is_stored_without_its_body(): void {
		list( $events, $first ) = $this->batch();
		$store                  = new ResultStore();
		$store->mark_pending( 'batch-10', $events );

		$refuse_bodies = static function ( $check, $object_id, $meta_key, $value ) {
			return ResultStore::META_KEY === $meta_key && '' !== $value['body'] ? false : $check;
		};
		add_filter( 'update_post_metadata', $refuse_bodies, 10, 4 );

		$store->record( 'batch-10', $events, new Result( Result::SENT, Result::OK, 200, '{"revalidated":[]}', null, 7, true ) );

		remove_filter( 'update_post_metadata', $refuse_bodies, 10 );

		$record = ResultStore::read_post( $first );
		$this->assertSame( Result::SENT, $record['status'] );
		$this->assertSame( 'batch-10', $record['batch_id'] );
		$this->assertSame( '', $record['body'] );
		$this->assertFalse( $record['truncated'], 'No body is kept, so none was cut.' );
		$this->assertSame( ResultStore::BODY_NOT_STORED, $record['error'] );
	}

	/**
	 * A transport error message that is not valid UTF-8 is stored scrubbed, on the first write and on
	 * the fallback without the body, so the status never stays `pending`.
	 */
	public function test_invalid_utf8_error_does_not_leave_the_record_pending(): void {
		list( $events, $first, $second ) = $this->batch();
		$store                           = new ResultStore();
		$store->mark_pending( 'batch-12', $events );

		$store->record( 'batch-12', $events, new Result( Result::FAILED, Result::TRANSPORT_ERROR, null, '', "cURL error 7: \xff\xfe \xc3", 3 ) );

		$record = ResultStore::read_post( $first );
		$this->assertSame( Result::FAILED, $record['status'] );
		$this->assertSame( 'batch-12', $record['batch_id'] );
		$this->assertTrue( wp_is_valid_utf8( $record['error'] ) );
		$this->assertStringStartsWith( 'cURL error 7: ', $record['error'] );

		$refuse_bodies = static function ( $check, $object_id, $meta_key, $value ) {
			return ResultStore::META_KEY === $meta_key && '' !== $value['body'] ? false : $check;
		};
		add_filter( 'update_post_metadata', $refuse_bodies, 10, 4 );

		$store->mark_pending( 'batch-13', $events );
		$store->record( 'batch-13', $events, new Result( Result::FAILED, Result::SERVER_ERROR, 500, 'oops', "\xff bad \xc3", 4 ) );

		remove_filter( 'update_post_metadata', $refuse_bodies, 10 );

		$record = ResultStore::read_post( $second );
		$this->assertSame( Result::FAILED, $record['status'] );
		$this->assertSame( 'batch-13', $record['batch_id'] );
		$this->assertSame( '', $record['body'] );
		$this->assertTrue( wp_is_valid_utf8( $record['error'] ) );
	}

	/**
	 * Writing the same record twice is not mistaken for a failure, although core returns false for an
	 * unchanged value. The two writes fall in the same second, and so are identical, on any normal run.
	 */
	public function test_identical_rewrite_is_not_a_failure(): void {
		list( $events, $first ) = $this->batch();
		$store                  = new ResultStore();
		$result                 = new Result( Result::SENT, Result::OK, 200, '{"revalidated":[]}', null, 7 );

		$store->record( 'batch-11', $events, $result );
		$store->record( 'batch-11', $events, $result );

		$this->assertSame( '{"revalidated":[]}', ResultStore::read_post( $first )['body'] );
		$this->assertNull( ResultStore::read_post( $first )['error'] );
	}

	/**
	 * An older cron batch's final result is not written over a newer batch's `pending`, on a resource
	 * or a term: the newer batch's own result replaces its pending, and a poll for the newer save must
	 * not read the older batch.
	 */
	public function test_older_final_over_newer_pending_is_skipped(): void {
		list( $events, $first, , $topic ) = $this->batch();
		$store                            = new ResultStore();

		$store->mark_pending( 'batch-old', $events );
		$store->mark_pending( 'batch-new', $events );
		$store->record( 'batch-old', $events, new Result( Result::FAILED, Result::SERVER_ERROR, 500, '{"error":"old"}', null, 9 ), true );

		$this->assertSame( ResultStore::PENDING, ResultStore::read_post( $first )['status'] );
		$this->assertSame( 'batch-new', ResultStore::read_post( $first )['batch_id'] );
		$this->assertSame( ResultStore::PENDING, ResultStore::read_term( $topic )['status'] );
		$this->assertSame( 'batch-new', ResultStore::read_term( $topic )['batch_id'] );
	}

	/**
	 * A cron batch's final result is written over its own batch's `pending`.
	 */
	public function test_final_over_its_own_pending_is_written(): void {
		list( $events, $first, , $topic ) = $this->batch();
		$store                            = new ResultStore();

		$store->mark_pending( 'batch-old', $events );
		$store->mark_pending( 'batch-new', $events );
		$store->record( 'batch-new', $events, new Result( Result::SENT, Result::OK, 200, '{"revalidated":[]}', null, 8 ), true );

		$this->assertSame( Result::SENT, ResultStore::read_post( $first )['status'] );
		$this->assertSame( 'batch-new', ResultStore::read_post( $first )['batch_id'] );
		$this->assertSame( Result::SENT, ResultStore::read_term( $topic )['status'] );
	}

	/**
	 * A cron batch's final result is written over another batch's final result: only a `pending` is protected.
	 */
	public function test_final_over_an_older_final_is_written(): void {
		list( $events, $first ) = $this->batch();
		$store                  = new ResultStore();

		$store->record( 'batch-old', $events, new Result( Result::FAILED, Result::TIMEOUT, null, '', 'timed out', 3001 ), true );
		$store->record( 'batch-new', $events, new Result( Result::FAILED, Result::SERVER_ERROR, 500, '{"error":"new"}', null, 6 ), true );

		$record = ResultStore::read_post( $first );
		$this->assertSame( Result::SERVER_ERROR, $record['outcome'] );
		$this->assertSame( 'batch-new', $record['batch_id'] );
	}

	/**
	 * A `pending` is written over anything: another batch's `pending` and another batch's final result.
	 */
	public function test_pending_over_anything_is_written(): void {
		list( $events, $first, $second ) = $this->batch();
		$store                           = new ResultStore();

		$store->mark_pending( 'batch-old', $events );
		$store->mark_pending( 'batch-new', $events );
		$this->assertSame( 'batch-new', ResultStore::read_post( $first )['batch_id'] );

		$store->record( 'batch-new', $events, new Result( Result::SENT, Result::OK, 200, '{"revalidated":[]}', null, 8 ), true );
		$store->mark_pending( 'batch-next', $events );

		$record = ResultStore::read_post( $second );
		$this->assertSame( ResultStore::PENDING, $record['status'] );
		$this->assertSame( 'batch-next', $record['batch_id'] );
	}

	/**
	 * A final with no `pending` of its own (a held-back event, a synchronous or unconfigured send, the
	 * status page's test) is written over another batch's `pending`, which may be older than it or
	 * left by a send that never ran.
	 */
	public function test_final_without_its_own_pending_is_written_over_another_pending(): void {
		list( $events, $first, , $topic ) = $this->batch();
		$store                            = new ResultStore();

		$store->mark_pending( 'batch-stuck', $events );
		$store->record( 'batch-held', array( $events[0] ), Result::no_single_type() );

		$this->assertSame( Result::NO_SINGLE_TYPE, ResultStore::read_post( $first )['outcome'] );
		$this->assertSame( 'batch-held', ResultStore::read_post( $first )['batch_id'] );

		$store->record( 'batch-sync', $events, Result::not_configured() );

		$this->assertSame( Result::NOT_CONFIGURED, ResultStore::read_post( $first )['outcome'] );
		$this->assertSame( Result::NOT_CONFIGURED, ResultStore::read_term( $topic )['outcome'] );
		$this->assertSame( 'batch-sync', ResultStore::read_term( $topic )['batch_id'] );
	}

	/**
	 * The REST field's schema lists every outcome, and `pending`.
	 */
	public function test_rest_schema_lists_every_outcome(): void {
		global $wp_rest_additional_fields;

		rest_get_server();

		$enum = $wp_rest_additional_fields['resource'][ ResultStore::REST_FIELD ]['schema']['properties']['outcome']['enum'];

		$this->assertContains( ResultStore::PENDING, $enum );
		$this->assertContains( Result::BAD_BODY, $enum );
		$this->assertContains( Result::ENCODE_ERROR, $enum );
		$this->assertSame( array_merge( array( ResultStore::PENDING ), Result::OUTCOMES ), $enum );
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

		foreach ( ResultStore::POST_TYPES as $post_type ) {
			$this->assertArrayHasKey( ResultStore::REST_FIELD, $wp_rest_additional_fields[ $post_type ] );

			$field = $wp_rest_additional_fields[ $post_type ][ ResultStore::REST_FIELD ];
			$this->assertNull( $field['update_callback'] );
			$this->assertTrue( $field['schema']['readonly'] );
			$this->assertSame( array( 'edit' ), $field['schema']['context'] );
		}

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
	 * A page's record is on `/wp/v2/pages` in the `edit` context, for a user who may edit the page, exactly
	 * as a resource's is: absent from `view`, absent from the public collection, and null from the callback
	 * for a user who cannot edit the page (issue #47).
	 */
	public function test_page_rest_field_is_edit_context_only(): void {
		$page_id = self::factory()->post->create(
			array(
				'post_type'   => PagePath::POST_TYPE,
				'post_status' => 'publish',
				'post_name'   => 'about',
			)
		);
		$store   = new ResultStore();
		$store->record(
			'batch-page',
			array( PageEvents::event( 'update', $page_id, '/about/', '/about/' ) ),
			new Result( Result::SENT, Result::OK, 200, '{"revalidated":["/about/"]}', null, 10 )
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$edit = new WP_REST_Request( 'GET', '/wp/v2/pages/' . $page_id );
		$edit->set_param( 'context', 'edit' );
		$edit_data = rest_get_server()->dispatch( $edit )->get_data();

		$this->assertArrayHasKey( ResultStore::REST_FIELD, $edit_data );
		$this->assertSame( Result::SENT, $edit_data[ ResultStore::REST_FIELD ]['status'] );
		$this->assertSame( 'update', $edit_data[ ResultStore::REST_FIELD ]['event'] );
		$this->assertSame( 'batch-page', $edit_data[ ResultStore::REST_FIELD ]['batch_id'] );

		$view = new WP_REST_Request( 'GET', '/wp/v2/pages/' . $page_id );
		$this->assertArrayNotHasKey( ResultStore::REST_FIELD, rest_get_server()->dispatch( $view )->get_data() );
		$this->assertNull( $store->rest_post_value( array( 'id' => $page_id ), ResultStore::REST_FIELD, $view ) );

		wp_set_current_user( 0 );
		$public = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/pages' ) )->get_data();
		$this->assertNotEmpty( $public );
		foreach ( $public as $item ) {
			$this->assertArrayNotHasKey( ResultStore::REST_FIELD, $item );
		}

		// A user who may not edit the page: core answers `context=edit` with a 403, and the callback with null.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, rest_get_server()->dispatch( $edit )->get_status() );
		$this->assertNull( $store->rest_post_value( array( 'id' => $page_id ), ResultStore::REST_FIELD, $edit ) );
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
