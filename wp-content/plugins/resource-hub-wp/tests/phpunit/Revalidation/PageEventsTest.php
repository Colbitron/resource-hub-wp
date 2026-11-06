<?php
/**
 * Page events: saves, deletes and Settings > Reading, through core's own functions (ADR 0052).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Revalidation;

use ResourceHub\Revalidation\PageEvents;
use ResourceHub\Revalidation\Payload;
use ResourceHub\Revalidation\ResultStore;

/**
 * Tests for {@see PageEvents} and for how the queue, the payload and the store treat page events.
 * Every queued event is checked against the request schema.
 */
final class PageEventsTest extends RevalidationTestCase {
	/**
	 * Starts with no front page and no posts page, and nothing queued.
	 */
	public function set_up(): void {
		parent::set_up();

		update_option( 'show_on_front', 'posts' );
		update_option( 'page_on_front', 0 );
		update_option( 'page_for_posts', 0 );
		$this->queue->clear();
	}

	/**
	 * Publishing a page sends `publish` with its path and no `previous`; a nested page's path is its chain.
	 */
	public function test_publishing_sends_publish_with_the_path(): void {
		$about = $this->page( 'about' );
		$draft = $this->page( 'team', 'draft', $about );
		$this->queue->clear();

		wp_update_post(
			array(
				'ID'          => $draft,
				'post_status' => 'publish',
			)
		);

		$event = $this->assert_single_queued_event();

		$this->assertSame(
			array(
				'type'     => 'page',
				'event'    => 'publish',
				'id'       => $draft,
				'path'     => '/about/team/',
				'previous' => null,
			),
			$event
		);
	}

	/**
	 * A slug change and a parent move are updates whose `previous` is the path before.
	 */
	public function test_slug_and_parent_changes_send_update_with_the_old_path(): void {
		$about   = $this->page( 'about' );
		$company = $this->page( 'company' );
		$team    = $this->page( 'team', 'publish', $about );
		$this->queue->clear();

		wp_update_post(
			array(
				'ID'        => $team,
				'post_name' => 'people',
			)
		);
		$renamed = $this->assert_single_queued_event();
		$this->assertSame( 'update', $renamed['event'] );
		$this->assertSame( '/about/people/', $renamed['path'] );
		$this->assertSame( array( 'path' => '/about/team/' ), $renamed['previous'] );

		$this->queue->clear();
		wp_update_post(
			array(
				'ID'          => $team,
				'post_parent' => $company,
			)
		);
		$moved = $this->assert_single_queued_event();
		$this->assertSame( '/company/people/', $moved['path'] );
		$this->assertSame( array( 'path' => '/about/people/' ), $moved['previous'] );
	}

	/**
	 * A content save that moves nothing is still an `update` with `previous` equal to the path.
	 */
	public function test_content_save_sends_update_with_the_same_path(): void {
		$about = $this->page( 'about' );
		$this->queue->clear();

		wp_update_post(
			array(
				'ID'           => $about,
				'post_content' => '<p>New words.</p>',
			)
		);

		$event = $this->assert_single_queued_event();
		$this->assertSame( 'update', $event['event'] );
		$this->assertSame( '/about/', $event['path'] );
		$this->assertSame( array( 'path' => '/about/' ), $event['previous'] );
	}

	/**
	 * Unpublishing sends `unpublish` with the last public path; trashing sends `trash`; a force delete sends `delete`.
	 */
	public function test_removals_send_the_last_public_path(): void {
		$about = $this->page( 'about' );
		$this->queue->clear();

		wp_update_post(
			array(
				'ID'          => $about,
				'post_status' => 'draft',
			)
		);
		$unpublished = $this->assert_single_queued_event();
		$this->assertSame( 'unpublish', $unpublished['event'] );
		$this->assertSame( '/about/', $unpublished['path'] );
		$this->assertNull( $unpublished['previous'] );

		$company = $this->page( 'company' );
		$this->queue->clear();
		wp_trash_post( $company );
		$trashed = $this->assert_single_queued_event();
		$this->assertSame( 'trash', $trashed['event'] );
		$this->assertSame( '/company/', $trashed['path'], 'The slug readers used, not the __trashed form.' );

		$this->queue->clear();
		wp_delete_post( $company, true );
		$this->assertTrue( $this->queue->is_empty(), 'A page already trashed sends nothing when deleted for good.' );

		$news = $this->page( 'news' );
		$this->queue->clear();
		wp_delete_post( $news, true );
		$deleted = $this->assert_single_queued_event();
		$this->assertSame( 'delete', $deleted['event'] );
		$this->assertSame( '/news/', $deleted['path'] );
	}

	/**
	 * Setting a page as the front page is an `update` from its own path to `/`; unsetting it the reverse;
	 * switching to another page moves both.
	 */
	public function test_settings_reading_moves_pages_between_their_path_and_the_root(): void {
		$home    = $this->page( 'home' );
		$welcome = $this->page( 'welcome' );
		$this->queue->clear();

		// Settings > Reading saves show_on_front first, then page_on_front.
		update_option( 'show_on_front', 'page' );
		$this->assertTrue( $this->queue->is_empty(), 'No front page is named yet.' );
		update_option( 'page_on_front', $home );
		$set = $this->assert_single_queued_event();
		$this->assertSame(
			array(
				'event'    => 'update',
				'id'       => $home,
				'path'     => '/',
				'previous' => array( 'path' => '/home/' ),
			),
			$this->shape( $set )
		);

		$this->queue->clear();
		update_option( 'page_on_front', $welcome );
		$events = $this->queue->events();
		$this->assertCount( 2, $events );
		$this->assert_valid_request(
			array(
				'version' => 1,
				'events'  => $events,
			)
		);
		$this->assertSame(
			array(
				'event'    => 'update',
				'id'       => $home,
				'path'     => '/home/',
				'previous' => array( 'path' => '/' ),
			),
			$this->shape( $events[0] )
		);
		$this->assertSame(
			array(
				'event'    => 'update',
				'id'       => $welcome,
				'path'     => '/',
				'previous' => array( 'path' => '/welcome/' ),
			),
			$this->shape( $events[1] )
		);

		$this->queue->clear();
		update_option( 'show_on_front', 'posts' );
		$unset = $this->assert_single_queued_event();
		$this->assertSame(
			array(
				'event'    => 'update',
				'id'       => $welcome,
				'path'     => '/welcome/',
				'previous' => array( 'path' => '/' ),
			),
			$this->shape( $unset )
		);

		$this->queue->clear();
		update_option( 'page_on_front', 0 );
		$this->assertTrue( $this->queue->is_empty(), 'With show_on_front on posts, page_on_front moves nothing.' );
	}

	/**
	 * Changing the posts page sends an `update` for the page that stops being served and the one that starts.
	 */
	public function test_posts_page_changes_send_updates_for_both_pages(): void {
		$news = $this->page( 'news' );
		$blog = $this->page( 'blog' );
		$this->queue->clear();

		update_option( 'page_for_posts', $news );
		$event = $this->assert_single_queued_event();
		$this->assertSame(
			array(
				'event'    => 'update',
				'id'       => $news,
				'path'     => '/news/',
				'previous' => array( 'path' => '/news/' ),
			),
			$this->shape( $event )
		);

		$this->queue->clear();
		update_option( 'page_for_posts', $blog );
		$events = $this->queue->events();
		$this->assertCount( 2, $events );
		$this->assertSame( array( $news, $blog ), array_column( $events, 'id' ) );

		// The posts page's own saves send nothing: it is never served.
		$this->queue->clear();
		wp_update_post(
			array(
				'ID'           => $blog,
				'post_content' => '<p>Nothing to see.</p>',
			)
		);
		$this->assertTrue( $this->queue->is_empty() );
	}

	/**
	 * Trashing the front page: core resets Settings > Reading on `wp_trash_post`, so the option hook and the
	 * save both fire, and the queue merges them into one `trash` under `/`, the path readers used.
	 */
	public function test_trashing_the_front_page_sends_trash_under_the_root(): void {
		$home = $this->page( 'home' );
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $home );
		$this->queue->clear();

		wp_trash_post( $home );

		$event = $this->assert_single_queued_event();
		$this->assertSame(
			array(
				'event'    => 'trash',
				'id'       => $home,
				'path'     => '/',
				'previous' => null,
			),
			$this->shape( $event )
		);
		$this->assertSame( 'posts', get_option( 'show_on_front' ), 'Core resets the setting; the test assumes it.' );
	}

	/**
	 * Drafts, posts, resources, autosaves and revisions send no page event.
	 */
	public function test_other_changes_send_nothing(): void {
		$draft = $this->page( 'draft-page', 'draft' );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => '<p>Still a draft.</p>',
			)
		);
		self::factory()->post->create( array( 'post_status' => 'publish' ) );
		$about = $this->page( 'about' );
		$this->queue->clear();
		wp_save_post_revision( $about );
		wp_create_post_autosave(
			array(
				'post_ID'      => $about,
				'post_content' => '<p>Autosaved.</p>',
				'post_type'    => 'page',
			)
		);

		$this->assertSame( array(), array_filter( $this->queue->events(), static fn( array $event ): bool => 'page' === $event['type'] && $event['id'] !== $about ) );
		foreach ( $this->queue->events() as $event ) {
			$this->assertNotSame( 'page', $event['type'] );
		}
	}

	/**
	 * `refresh()` re-reads the path of a `publish` or `update` from the page and the options as they are now.
	 */
	public function test_refresh_rereads_the_path(): void {
		$home  = $this->page( 'home' );
		$event = PageEvents::event( 'update', $home, '/stale/', '/older/' );

		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $home );

		$refreshed = PageEvents::refresh( $event );
		$this->assertSame( '/', $refreshed['path'] );
		$this->assertSame( array( 'path' => '/older/' ), $refreshed['previous'] );

		$trash = PageEvents::event( 'trash', $home, '/stale/', null );
		$this->assertSame( $trash, PageEvents::refresh( $trash ) );

		wp_update_post(
			array(
				'ID'          => $home,
				'post_status' => 'draft',
			)
		);
		$this->assertSame( $event, PageEvents::refresh( $event ) );
	}

	/**
	 * A stored escape the front end's router would decode is decoded in every segment of the path and of `previous.path`.
	 */
	public function test_decode_slugs_decodes_each_segment(): void {
		$event = PageEvents::event( 'update', 7, '/case%2dstudy/te%41m/', '/old%2dname/' );

		$decoded = Payload::decode_slugs( $event );

		$this->assertSame( '/case-study/team/', $decoded['path'] );
		$this->assertSame( array( 'path' => '/old-name/' ), $decoded['previous'] );
		$this->assertSame( '/', Payload::decode_slugs( PageEvents::event( 'publish', 7, '/', null ) )['path'] );
	}

	/**
	 * At `shutdown`, a page event goes out in a schema-valid batch and its result lands on the page's meta.
	 */
	public function test_flush_sends_the_event_and_records_it_on_the_page(): void {
		$this->configure();
		$about = $this->page( 'about' );
		$this->queue->clear();

		wp_update_post(
			array(
				'ID'        => $about,
				'post_name' => 'about-us',
			)
		);

		$dispatcher     = \ResourceHub\Revalidation\Revalidation::instance()->dispatcher();
		$this->requests = array();
		$dispatcher->flush();

		$pending = ResultStore::read_post( $about );
		$this->assertSame( ResultStore::PENDING, $pending['status'] );
		$this->assertSame( 'update', $pending['event'] );

		$cron     = _get_cron_array();
		$payloads = array();
		foreach ( $cron as $hooks ) {
			foreach ( $hooks[ \ResourceHub\Revalidation\Dispatcher::CRON_HOOK ] ?? array() as $job ) {
				$payloads[] = $job['args'];
			}
		}
		$this->assertNotEmpty( $payloads, 'A batch was scheduled.' );
		list( $batch_id, $payload ) = end( $payloads );
		$this->assert_valid_request( $payload );
		$this->assertSame( '/about-us/', $payload['events'][0]['path'] );
		$this->assertSame( array( 'path' => '/about/' ), $payload['events'][0]['previous'] );

		// The batch's own ID, so the store writes the result over the pending it wrote itself.
		$dispatcher->run( $batch_id, $payload );
		$this->assertCount( 1, $this->revalidate_requests() );
		$record = ResultStore::read_post( $about );
		$this->assertSame( 'sent', $record['status'] );
		$this->assertSame( 'update', $record['event'] );
	}

	/**
	 * The event's identifying fields, for comparisons that leave `type` out.
	 *
	 * @param array<string, mixed> $event The event.
	 * @return array<string, mixed>
	 */
	private function shape( array $event ): array {
		$this->assertSame( 'page', $event['type'] );

		return array(
			'event'    => $event['event'],
			'id'       => $event['id'],
			'path'     => $event['path'],
			'previous' => $event['previous'],
		);
	}

	/**
	 * Creates a page and clears the queue of its creation event.
	 *
	 * @param string $slug      Slug.
	 * @param string $status    Status.
	 * @param int    $parent_id Parent page ID.
	 */
	private function page( string $slug, string $status = 'publish', int $parent_id = 0 ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => 'page',
				'post_status' => $status,
				'post_name'   => $slug,
				'post_title'  => ucfirst( $slug ),
				'post_parent' => $parent_id,
			)
		);
		$this->queue->clear();

		return $post_id;
	}
}
