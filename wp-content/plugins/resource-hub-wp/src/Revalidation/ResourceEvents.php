<?php
/**
 * Turns saves and deletes of resources into resource events.
 *
 * This file is a critical path: it is read line by line before merge. Each hook method says which
 * core hook it answers and what it decides.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_Post;

/**
 * Derives `publish`, `update`, `unpublish`, `trash` and `delete` from core's post hooks (ADR 0011).
 * The state each event carries, and `previous` on `update`, are in `packages/ui/README.md`.
 *
 * `wp_after_insert_post` is the one trigger for saves: it fires after terms and meta are written,
 * from every write path (the REST controller, `wp_insert_post()`, `wp_publish_post()`, and the
 * trash, which is a status update). The event is the change in `post_status` from `$post_before`
 * to the saved post. `before_delete_post` covers a force delete of a published resource, while the
 * post and its terms still exist.
 *
 * `$post_before` is the post row, not its terms, and a REST save writes new terms before the hook
 * fires. The terms a resource had before a save are therefore snapshotted at `pre_post_update`,
 * which core fires inside `wp_insert_post()` before the row is updated and before any path writes
 * terms. The snapshot feeds `previous` on `update` and the last public state on `unpublish` and `trash`.
 *
 * Plain PHP can also insert a post and assign its terms afterwards (`wp_insert_post()` then
 * `wp_set_object_terms()`, as the seeder does), and then the hook fires before the terms exist.
 * So the public state of a `publish` or `update` event is read again from the post at `shutdown`,
 * through {@see ResourceEvents::refresh()}, when the request has finished writing.
 */
final class ResourceEvents {
	/**
	 * The queue events go to.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Term slugs by post ID, taken before a save and consumed by the save's `wp_after_insert_post`.
	 *
	 * @var array<int, array{types: string[], topics: string[]}>
	 */
	private array $snapshots = array();

	/**
	 * Constructor.
	 *
	 * @param Queue $queue The per-request queue.
	 */
	public function __construct( Queue $queue ) {
		$this->queue = $queue;
	}

	/**
	 * Hooks the three core actions.
	 */
	public function register(): void {
		add_action( 'pre_post_update', array( $this, 'snapshot_terms' ), 10, 2 );
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert' ), 10, 4 );
		add_action( 'before_delete_post', array( $this, 'on_before_delete' ), 10, 2 );
	}

	/**
	 * `pre_post_update`: remembers a resource's type and topic slugs before the save changes them.
	 *
	 * @param int                  $post_id Post being updated.
	 * @param array<string, mixed> $data    The sanitized post data about to be written.
	 */
	public function snapshot_terms( int $post_id, array $data ): void {
		if ( PostType::NAME !== ( $data['post_type'] ?? '' ) ) {
			return;
		}

		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return;
		}

		$this->snapshots[ $post_id ] = array(
			'types'  => ResourceState::term_slugs( $post, Taxonomies::TYPE ),
			'topics' => ResourceState::term_slugs( $post, Taxonomies::TOPIC ),
		);
	}

	/**
	 * `wp_after_insert_post`: queues the event the save amounts to, if it touched public state.
	 *
	 * Autosaves and revisions are their own post type and are ignored. A save that leaves the
	 * resource unpublished before and after (editing a draft, restoring from the trash) sends nothing.
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        The post as saved.
	 * @param bool         $update      Whether this is an update of an existing post.
	 * @param WP_Post|null $post_before The post before the save, or null for a new post.
	 */
	public function on_after_insert( int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before ): void {
		$snapshot = $this->snapshots[ $post_id ] ?? null;
		unset( $this->snapshots[ $post_id ] );

		if ( PostType::NAME !== $post->post_type || wp_is_post_autosave( $post ) || wp_is_post_revision( $post ) ) {
			return;
		}

		$event = self::derive( $post_before?->post_status, $post->post_status );

		if ( null === $event ) {
			return;
		}

		if ( 'publish' === $event ) {
			$this->queue->add( self::event( 'publish', $post->ID, ResourceState::of_post( $post ), null ) );

			return;
		}

		// Every other event means the post was public before, so `$post_before` is set. The state readers
		// knew is its slug and the terms before the save: the snapshot when there is one, else the current ones.
		$last_public = ResourceState::build(
			$post_before?->post_name ?? $post->post_name,
			$snapshot['types'] ?? ResourceState::term_slugs( $post, Taxonomies::TYPE ),
			$snapshot['topics'] ?? ResourceState::term_slugs( $post, Taxonomies::TOPIC )
		);

		if ( 'update' === $event ) {
			$this->queue->add( self::event( 'update', $post->ID, ResourceState::of_post( $post ), $last_public ) );

			return;
		}

		// `unpublish` and `trash`: the top-level fields are the last public state, the one the front end can have cached.
		$this->queue->add( self::event( $event, $post->ID, $last_public, null ) );
	}

	/**
	 * `before_delete_post`: a force delete of a published resource is a `delete` event.
	 *
	 * A resource in the trash was removed from the front end by its `trash` event, so deleting it
	 * permanently sends nothing. The hook fires while the terms still exist, so the state is complete.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    The post about to be deleted.
	 */
	public function on_before_delete( int $post_id, WP_Post $post ): void {
		if ( PostType::NAME !== $post->post_type || 'publish' !== $post->post_status ) {
			return;
		}

		$this->queue->add( self::event( 'delete', $post->ID, ResourceState::of_post( $post ), null ) );
	}

	/**
	 * Re-reads the top-level state of a `publish` or `update` event from the post as it is now. Called
	 * by the dispatcher at `shutdown`, so an event describes the resource as the request left it, not
	 * as it was mid-save. Removal events keep the state captured at the hook, because the post has
	 * since been trashed, hidden or deleted. An event whose post is no longer a published resource is
	 * returned as it was.
	 *
	 * @param array<string, mixed> $event A resource event.
	 * @return array<string, mixed>
	 */
	public static function refresh( array $event ): array {
		if ( ! in_array( $event['event'], array( 'publish', 'update' ), true ) ) {
			return $event;
		}

		$post = get_post( (int) $event['id'] );

		if ( ! $post instanceof WP_Post || PostType::NAME !== $post->post_type || 'publish' !== $post->post_status ) {
			return $event;
		}

		return array_merge( $event, ResourceState::of_post( $post ) );
	}

	/**
	 * The event a status change amounts to, or null when it never touched public state.
	 *
	 * Public means `publish`. Anything else (draft, pending, private, future, trash, auto-draft) is not.
	 *
	 * @param string|null $before Status before the save; null for a new post.
	 * @param string      $after  Status after the save.
	 */
	public static function derive( ?string $before, string $after ): ?string {
		$was_public = 'publish' === $before;
		$is_public  = 'publish' === $after;

		if ( ! $was_public && ! $is_public ) {
			return null;
		}

		if ( ! $was_public ) {
			return 'publish';
		}

		if ( $is_public ) {
			return 'update';
		}

		return 'trash' === $after ? 'trash' : 'unpublish';
	}

	/**
	 * An `update` event that re-sends a published resource's current state, with `previous` equal to
	 * it. For the status page's "Send test revalidation". Null unless the post is a
	 * published resource.
	 *
	 * @param WP_Post $post The post.
	 * @return array<string, mixed>|null
	 */
	public static function update_event_for( WP_Post $post ): ?array {
		if ( PostType::NAME !== $post->post_type || 'publish' !== $post->post_status ) {
			return null;
		}

		$state = ResourceState::of_post( $post );

		return self::event( 'update', $post->ID, $state, $state );
	}

	/**
	 * A resource event as the payload carries it (`resourceEvent` in the request schema).
	 *
	 * @param string                                                      $event    One of the five event names.
	 * @param int                                                         $id       Post ID.
	 * @param array{slug: string, types: string[], topics: string[]}      $state    The public state the event concerns.
	 * @param array{slug: string, types: string[], topics: string[]}|null $previous The state before an `update`, else null.
	 * @return array<string, mixed>
	 */
	public static function event( string $event, int $id, array $state, ?array $previous ): array {
		return array(
			'type'     => 'resource',
			'event'    => $event,
			'id'       => $id,
			'slug'     => $state['slug'],
			'rest_url' => ResourceState::rest_url( $id ),
			'types'    => $state['types'],
			'topics'   => $state['topics'],
			'previous' => $previous,
		);
	}
}
