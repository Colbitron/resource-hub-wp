<?php
/**
 * Resource events: which save produces which event, with which state.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Revalidation\ResourceEvents;
use WP_REST_Request;

/**
 * Tests for {@see ResourceEvents} through core's real write paths (ADRs 0011, 0015, 0016).
 */
final class ResourceEventsTest extends RevalidationTestCase {
	/**
	 * The event for each status transition, one case per clause of `derive()`.
	 *
	 * @dataProvider transitions
	 *
	 * @param string|null $before   Status before.
	 * @param string      $after    Status after.
	 * @param string|null $expected Event, or null for none.
	 */
	public function test_derive( ?string $before, string $after, ?string $expected ): void {
		$this->assertSame( $expected, ResourceEvents::derive( $before, $after ) );
	}

	/**
	 * Cases for test_derive().
	 *
	 * @return array<string, array{0: string|null, 1: string, 2: string|null}>
	 */
	public function transitions(): array {
		return array(
			'new published post'  => array( null, 'publish', 'publish' ),
			'new draft'           => array( null, 'draft', null ),
			'draft to publish'    => array( 'draft', 'publish', 'publish' ),
			'future to publish'   => array( 'future', 'publish', 'publish' ),
			'private to publish'  => array( 'private', 'publish', 'publish' ),
			'publish to publish'  => array( 'publish', 'publish', 'update' ),
			'publish to draft'    => array( 'publish', 'draft', 'unpublish' ),
			'publish to pending'  => array( 'publish', 'pending', 'unpublish' ),
			'publish to private'  => array( 'publish', 'private', 'unpublish' ),
			'publish to future'   => array( 'publish', 'future', 'unpublish' ),
			'publish to trash'    => array( 'publish', 'trash', 'trash' ),
			'draft to draft'      => array( 'draft', 'draft', null ),
			'draft to trash'      => array( 'draft', 'trash', null ),
			'trash to draft'      => array( 'trash', 'draft', null ),
			'auto-draft to draft' => array( 'auto-draft', 'draft', null ),
		);
	}

	/**
	 * Publishing a draft sends `publish` with the state after the save and no `previous`.
	 */
	public function test_publishing_a_draft_sends_publish(): void {
		$post_id = $this->make_resource( 'draft', 'first-webinar', 'webinar', array( 'performance' ) );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'publish',
			)
		);

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'resource', $event['type'] );
		$this->assertSame( 'publish', $event['event'] );
		$this->assertSame( $post_id, $event['id'] );
		$this->assertSame( 'first-webinar', $event['slug'] );
		$this->assertSame( array( 'webinar' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * A new post inserted as published sends `publish` too; `$post_before` is null on that path.
	 */
	public function test_inserting_a_published_post_sends_publish(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_name'   => 'born-public',
			)
		);

		$events = $this->queue->events();

		$this->assertCount( 1, $events );
		$this->assertSame( 'publish', $events[0]['event'] );
		$this->assertSame( $post_id, $events[0]['id'] );
		$this->assertNull( $events[0]['previous'] );
	}

	/**
	 * `rest_url` is the resource's core REST URL under `/wp-json/` when pretty permalinks are on.
	 */
	public function test_rest_url_is_the_core_rest_url(): void {
		$this->set_permalink_structure( '/%postname%/' );

		try {
			$post_id = $this->make_resource( 'draft', 'rest-url-check' );
			wp_update_post(
				array(
					'ID'          => $post_id,
					'post_status' => 'publish',
				)
			);

			$event = $this->assert_single_queued_event();

			$this->assertSame( home_url( '/wp-json/wp/v2/resources/' . $post_id ), $event['rest_url'] );
		} finally {
			$this->set_permalink_structure( '' );
		}
	}

	/**
	 * Saving a published resource over REST with a new slug, type and topics sends `update` whose
	 * top-level fields are the new state and whose `previous` is the state before the save, including
	 * the terms the REST controller only writes after `wp_update_post()`.
	 */
	public function test_rest_update_carries_previous_slug_type_and_topics(): void {
		$post_id   = $this->make_resource( 'publish', 'old-slug', 'webinar', array( 'performance', 'accessibility' ) );
		$podcast   = $this->term_id( Taxonomies::TYPE, 'podcast' );
		$workflow  = $this->term_id( Taxonomies::TOPIC, 'editorial-workflow' );
		$editor_id = self::factory()->user->create( array( 'role' => 'editor' ) );

		wp_set_current_user( $editor_id );

		$request = new WP_REST_Request( 'POST', '/wp/v2/resources/' . $post_id );
		$request->set_body_params(
			array(
				'slug'           => 'new-slug',
				'resource_type'  => array( $podcast ),
				'resource_topic' => array( $workflow ),
			)
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'new-slug', $event['slug'] );
		$this->assertSame( array( 'podcast' ), $event['types'] );
		$this->assertSame( array( 'editorial-workflow' ), $event['topics'] );
		$this->assertSame(
			array(
				'slug'   => 'old-slug',
				'types'  => array( 'webinar' ),
				'topics' => array( 'accessibility', 'performance' ),
			),
			$event['previous']
		);
	}

	/**
	 * An update that changes nothing public still sends `update`, with `previous` equal to the current state.
	 */
	public function test_update_without_public_changes_still_sends_update(): void {
		$post_id = $this->make_resource( 'publish', 'steady', 'ebook', array( 'performance' ) );

		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'A new title',
			)
		);

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'update', $event['event'] );
		$this->assertSame(
			array(
				'slug'   => 'steady',
				'types'  => array( 'ebook' ),
				'topics' => array( 'performance' ),
			),
			$event['previous']
		);
	}

	/**
	 * Moving a published resource to draft sends `unpublish` with the last public state and no `previous`.
	 */
	public function test_unpublishing_sends_unpublish_with_the_last_public_state(): void {
		$post_id = $this->make_resource( 'publish', 'was-public', 'article', array( 'performance' ) );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'draft',
				'post_name'   => 'renamed-while-hidden',
			)
		);

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'unpublish', $event['event'] );
		$this->assertSame( 'was-public', $event['slug'] );
		$this->assertSame( array( 'article' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * Unpublishing over REST while also changing the topics reports the topics readers last saw, not the new ones.
	 */
	public function test_rest_unpublish_reports_the_terms_before_the_save(): void {
		$post_id = $this->make_resource( 'publish', 'hidden-later', 'article', array( 'performance' ) );
		$a11y    = $this->term_id( Taxonomies::TOPIC, 'accessibility' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$request = new WP_REST_Request( 'POST', '/wp/v2/resources/' . $post_id );
		$request->set_body_params(
			array(
				'status'         => 'draft',
				'resource_topic' => array( $a11y ),
			)
		);
		$this->assertSame( 200, rest_get_server()->dispatch( $request )->get_status() );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'unpublish', $event['event'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
	}

	/**
	 * Trashing a published resource sends `trash` under the slug readers used, never the `__trashed` slug core assigns.
	 */
	public function test_trashing_sends_trash_with_the_original_slug(): void {
		$post_id = $this->make_resource( 'publish', 'soon-gone', 'podcast', array( 'accessibility' ) );

		wp_trash_post( $post_id );

		$this->assertSame( 'soon-gone__trashed', get_post( $post_id )->post_name, 'Core renames a trashed slug; the test relies on it.' );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'trash', $event['event'] );
		$this->assertSame( 'soon-gone', $event['slug'] );
		$this->assertSame( array( 'podcast' ), $event['types'] );
		$this->assertSame( array( 'accessibility' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * Force-deleting a published resource sends `delete` with its state; the hook fires while the terms still exist.
	 */
	public function test_force_deleting_a_published_resource_sends_delete(): void {
		$post_id = $this->make_resource( 'publish', 'deleted-outright', 'case-study', array( 'performance' ) );

		wp_delete_post( $post_id, true );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'delete', $event['event'] );
		$this->assertSame( $post_id, $event['id'] );
		$this->assertSame( 'deleted-outright', $event['slug'] );
		$this->assertSame( array( 'case-study' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * An update that renames a resource and changes its topics, followed by a removal in the same request,
	 * sends the removal under the state from before the update: the one the front end can have cached,
	 * not the renamed state that only existed during the request.
	 *
	 * @dataProvider removals_after_an_update
	 *
	 * @param string $removal How the resource is removed: `trash`, `unpublish` or `delete`.
	 */
	public function test_removal_after_an_update_reports_the_state_before_the_request( string $removal ): void {
		$post_id = $this->make_resource( 'publish', 'original-slug', 'webinar', array( 'performance' ) );
		$a11y    = $this->term_id( Taxonomies::TOPIC, 'accessibility' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		wp_update_post(
			array(
				'ID'        => $post_id,
				'post_name' => 'renamed-slug',
				'tax_input' => array( Taxonomies::TOPIC => array( $a11y ) ),
			)
		);

		$this->assertSame( 'renamed-slug', $this->queue->events()[0]['slug'], 'The update raised the renamed state.' );

		switch ( $removal ) {
			case 'trash':
				wp_trash_post( $post_id );
				break;
			case 'unpublish':
				wp_update_post(
					array(
						'ID'          => $post_id,
						'post_status' => 'draft',
					)
				);
				break;
			case 'delete':
				wp_delete_post( $post_id, true );
				break;
		}

		$event = $this->assert_single_queued_event();

		$this->assertSame( $removal, $event['event'] );
		$this->assertSame( $post_id, $event['id'] );
		$this->assertSame( 'original-slug', $event['slug'] );
		$this->assertSame( array( 'webinar' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * Cases for test_removal_after_an_update_reports_the_state_before_the_request().
	 *
	 * @return array<string, array{0: string}>
	 */
	public function removals_after_an_update(): array {
		return array(
			'update then trash'        => array( 'trash' ),
			'update then unpublish'    => array( 'unpublish' ),
			'update then force delete' => array( 'delete' ),
		);
	}

	/**
	 * A scheduled resource published by core's `wp_publish_post()`, as the cron job for a scheduled post
	 * does, sends `publish` with its state and no `previous`.
	 */
	public function test_scheduled_publish_sends_publish(): void {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'future',
				'post_name'   => 'scheduled-one',
				'post_date'   => gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS ),
			)
		);
		wp_set_object_terms( $post_id, array( $this->term_id( Taxonomies::TYPE, 'webinar' ) ), Taxonomies::TYPE );
		wp_set_object_terms( $post_id, array( $this->term_id( Taxonomies::TOPIC, 'performance' ) ), Taxonomies::TOPIC );
		$this->queue->clear();

		$this->assertSame( 'future', get_post_status( $post_id ) );

		wp_publish_post( $post_id );

		$event = $this->assert_single_queued_event();

		$this->assertSame( 'publish', $event['event'] );
		$this->assertSame( $post_id, $event['id'] );
		$this->assertSame( 'scheduled-one', $event['slug'] );
		$this->assertSame( array( 'webinar' ), $event['types'] );
		$this->assertSame( array( 'performance' ), $event['topics'] );
		$this->assertNull( $event['previous'] );
	}

	/**
	 * Saves that never touch public state send nothing: editing a draft, trashing a draft, deleting a
	 * trashed resource, restoring from the trash, and a force delete of a draft.
	 */
	public function test_changes_outside_public_state_send_nothing(): void {
		$draft = $this->make_resource( 'draft', 'still-a-draft' );
		wp_update_post(
			array(
				'ID'         => $draft,
				'post_title' => 'Edited draft',
			)
		);
		$this->assertTrue( $this->queue->is_empty(), 'Editing a draft queued an event.' );

		wp_trash_post( $draft );
		$this->assertTrue( $this->queue->is_empty(), 'Trashing a draft queued an event.' );

		wp_untrash_post( $draft );
		$this->assertTrue( $this->queue->is_empty(), 'Restoring a draft queued an event.' );

		wp_delete_post( $draft, true );
		$this->assertTrue( $this->queue->is_empty(), 'Force-deleting a draft queued an event.' );

		$published = $this->make_resource( 'publish', 'published-then-trashed' );
		wp_trash_post( $published );
		$this->queue->clear();

		wp_untrash_post( $published );
		$this->assertTrue( $this->queue->is_empty(), 'Restoring from the trash queued an event.' );

		wp_trash_post( $published );
		$this->queue->clear();

		wp_delete_post( $published, true );
		$this->assertTrue( $this->queue->is_empty(), 'Deleting an already trashed resource queued an event.' );
	}

	/**
	 * Revisions and autosaves of a published resource are not resource saves and send nothing.
	 */
	public function test_revisions_and_autosaves_send_nothing(): void {
		$post_id = $this->make_resource( 'publish', 'with-history' );

		wp_save_post_revision( $post_id );
		$this->assertTrue( $this->queue->is_empty(), 'A revision queued an event.' );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$autosave = wp_create_post_autosave(
			array(
				'post_ID'      => $post_id,
				'post_type'    => PostType::NAME,
				'post_title'   => 'Autosaved title',
				'post_content' => 'Autosaved content',
			)
		);
		$this->assertIsInt( $autosave, 'Autosave failed: ' . ( is_wp_error( $autosave ) ? $autosave->get_error_message() : 'unknown' ) );
		$this->assertSame( 'revision', get_post( $autosave )->post_type );
		$this->assertTrue( $this->queue->is_empty(), 'An autosave queued an event.' );
	}

	/**
	 * Other post types are ignored even when they are published, trashed or deleted.
	 */
	public function test_other_post_types_are_ignored(): void {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Changed',
			)
		);
		wp_trash_post( $post_id );
		wp_delete_post( $post_id, true );

		$this->assertTrue( $this->queue->is_empty() );
	}

	/**
	 * `refresh()` re-reads the state of a `publish` or `update` event from the post, leaves a removal event
	 * and an event for a post that is no longer published alone.
	 */
	public function test_refresh_rereads_public_events_only(): void {
		$post_id = $this->make_resource( 'publish', 'before-terms', 'webinar' );
		$event   = ResourceEvents::event(
			'publish',
			$post_id,
			array(
				'slug'   => 'stale',
				'types'  => array(),
				'topics' => array(),
			),
			null
		);
		$trash   = ResourceEvents::event(
			'trash',
			$post_id,
			array(
				'slug'   => 'stale',
				'types'  => array(),
				'topics' => array(),
			),
			null
		);

		wp_set_object_terms( $post_id, array( $this->term_id( Taxonomies::TOPIC, 'performance' ) ), Taxonomies::TOPIC );

		$refreshed = ResourceEvents::refresh( $event );
		$this->assertSame( 'before-terms', $refreshed['slug'] );
		$this->assertSame( array( 'webinar' ), $refreshed['types'] );
		$this->assertSame( array( 'performance' ), $refreshed['topics'] );
		$this->assertSame( 'publish', $refreshed['event'] );
		$this->assertNull( $refreshed['previous'] );

		$this->assertSame( $trash, ResourceEvents::refresh( $trash ) );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_status' => 'draft',
			)
		);
		$this->assertSame( $event, ResourceEvents::refresh( $event ) );
	}

	/**
	 * The test button's event is an `update` whose `previous` repeats the current state, only for a published resource.
	 */
	public function test_update_event_for_repeats_the_current_state(): void {
		$post_id = $this->make_resource( 'publish', 'pinged', 'webinar', array( 'performance' ) );
		$event   = ResourceEvents::update_event_for( get_post( $post_id ) );

		$this->assertNotNull( $event );
		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( 'pinged', $event['slug'] );
		$this->assertSame( $event['previous'], array_intersect_key( $event, array_flip( array( 'slug', 'types', 'topics' ) ) ) );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => array( $event ),
			)
		);

		$draft = $this->make_resource( 'draft', 'not-public' );
		$this->assertNull( ResourceEvents::update_event_for( get_post( $draft ) ) );
	}
}
