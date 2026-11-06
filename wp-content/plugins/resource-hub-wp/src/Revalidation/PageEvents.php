<?php
/**
 * Turns changes to pages, and to Settings > Reading, into page events.
 *
 * This file is a critical path: it is read line by line before merge. Each hook method says which
 * core hook it answers and what it decides.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

use ResourceHub\Pages\PagePath;
use WP_Post;

/**
 * Derives `publish`, `update`, `unpublish`, `trash` and `delete` for WordPress pages as the front
 * end serves them (ADR 0052): `pageEvent` in the request schema, `{ type: "page", event, id, path,
 * previous: { path } | null }`, where `path` is the page's public path, `/` for the static front page.
 *
 * Two kinds of change move a page's public path. A save (`wp_after_insert_post`, as for resources,
 * ADR 0011) can publish, unpublish or trash it, or change its slug or parent; `$post_before` carries
 * the slug and parent before the save, and the ancestors are read as they are now, so a parent
 * renamed in the same request already shows its new slug, which that parent's own event covers.
 * Settings > Reading (`show_on_front`, `page_on_front`, `page_for_posts`) moves a page between its
 * own path and `/`, or in and out of being served at all, without saving the page: each option hook
 * sends an `update` for the page it affects. Core itself resets the two front-page options when the
 * front page is trashed or deleted (`_reset_front_page_settings_for_post()`), so that trash is seen
 * here as an option change and a save, which the {@see Queue} merges into one `trash` under `/`,
 * the path readers used. A page's children get no event when their parent moves or is renamed;
 * the front end's one `pages` tag reaches them.
 *
 * `delete` comes from `before_delete_post` for a published page, while the post still exists. A
 * change that never touches a served page (a draft saved, the posts page edited, a post of any
 * other type) sends nothing.
 */
final class PageEvents {
	/**
	 * The options whose change moves a page's public path or its being served.
	 */
	public const OPTIONS = array( 'show_on_front', 'page_on_front', 'page_for_posts' );

	/**
	 * The queue events go to.
	 *
	 * @var Queue
	 */
	private Queue $queue;

	/**
	 * Constructor.
	 *
	 * @param Queue $queue The per-request queue.
	 */
	public function __construct( Queue $queue ) {
		$this->queue = $queue;
	}

	/**
	 * Hooks the post actions and the option actions. An option that does not exist yet is added, not
	 * updated, so `add_option_{$option}` is hooked beside `update_option_{$option}`.
	 */
	public function register(): void {
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert' ), 10, 4 );
		add_action( 'before_delete_post', array( $this, 'on_before_delete' ), 10, 2 );
		add_action( 'update_option_show_on_front', array( $this, 'on_show_on_front' ), 10, 2 );
		add_action( 'add_option_show_on_front', array( $this, 'on_show_on_front_added' ), 10, 2 );
		add_action( 'update_option_page_on_front', array( $this, 'on_page_on_front' ), 10, 2 );
		add_action( 'add_option_page_on_front', array( $this, 'on_page_on_front_added' ), 10, 2 );
		add_action( 'update_option_page_for_posts', array( $this, 'on_page_for_posts' ), 10, 2 );
		add_action( 'add_option_page_for_posts', array( $this, 'on_page_for_posts_added' ), 10, 2 );
	}

	/**
	 * `wp_after_insert_post`: queues the event a page's save amounts to, if it touched its public path.
	 *
	 * The event is the change from `$post_before` to the saved post, both judged as the options stand
	 * at the hook: served before and after is an `update` whose `previous` is the path before; not
	 * served before and served after is a `publish`; served before and not after is an `unpublish`,
	 * or a `trash` when the save trashed it, with the path before at the top level.
	 *
	 * @param int          $post_id     Post ID.
	 * @param WP_Post      $post        The post as saved.
	 * @param bool         $update      Whether this is an update of an existing post.
	 * @param WP_Post|null $post_before The post before the save, or null for a new post.
	 */
	public function on_after_insert( int $post_id, WP_Post $post, bool $update, ?WP_Post $post_before ): void {
		unset( $post_id, $update );

		if ( PagePath::POST_TYPE !== $post->post_type || wp_is_post_autosave( $post ) || wp_is_post_revision( $post ) ) {
			return;
		}

		$was_served = $post_before instanceof WP_Post && PagePath::is_served( $post_before );
		$is_served  = PagePath::is_served( $post );

		if ( ! $was_served && ! $is_served ) {
			return;
		}

		if ( ! $was_served ) {
			$this->queue->add( self::event( 'publish', $post->ID, PagePath::of_post( $post ), null ) );

			return;
		}

		// `$post_before` is set: the page was served, so it existed before the save.
		$before = PagePath::of_post( $post_before );

		if ( $is_served ) {
			$this->queue->add( self::event( 'update', $post->ID, PagePath::of_post( $post ), $before ) );

			return;
		}

		$this->queue->add( self::event( 'trash' === $post->post_status ? 'trash' : 'unpublish', $post->ID, $before, null ) );
	}

	/**
	 * `before_delete_post`: a force delete of a served page is a `delete` event. A page in the trash was
	 * removed from the front end by its `trash` event, so deleting it permanently sends nothing.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    The post about to be deleted.
	 */
	public function on_before_delete( int $post_id, WP_Post $post ): void {
		unset( $post_id );

		if ( ! PagePath::is_served( $post ) ) {
			return;
		}

		$this->queue->add( self::event( 'delete', $post->ID, PagePath::of_post( $post ), null ) );
	}

	/**
	 * `update_option_show_on_front`: switching to or from `page` moves the page `page_on_front` names
	 * between `/` and its own path.
	 *
	 * @param mixed $old_value The value before.
	 * @param mixed $value     The value after.
	 */
	public function on_show_on_front( mixed $old_value, mixed $value ): void {
		$page = (int) get_option( 'page_on_front' );

		if ( 'page' === $old_value && 'page' !== $value ) {
			$this->moved( $page, '/', null );
		} elseif ( 'page' !== $old_value && 'page' === $value ) {
			$this->moved( $page, null, '/' );
		}
	}

	/**
	 * `add_option_show_on_front`: as an update from the default, `posts`.
	 *
	 * @param string $option The option name. Unused.
	 * @param mixed  $value  The value added.
	 */
	public function on_show_on_front_added( string $option, mixed $value ): void {
		unset( $option );
		$this->on_show_on_front( 'posts', $value );
	}

	/**
	 * `update_option_page_on_front`: while `show_on_front` is `page`, the old page goes back to its own
	 * path and the new one moves to `/`.
	 *
	 * @param mixed $old_value The value before.
	 * @param mixed $value     The value after.
	 */
	public function on_page_on_front( mixed $old_value, mixed $value ): void {
		if ( 'page' !== get_option( 'show_on_front' ) ) {
			return;
		}

		$this->moved( (int) $old_value, '/', null );
		$this->moved( (int) $value, null, '/' );
	}

	/**
	 * `add_option_page_on_front`: as an update from the default, 0.
	 *
	 * @param string $option The option name. Unused.
	 * @param mixed  $value  The value added.
	 */
	public function on_page_on_front_added( string $option, mixed $value ): void {
		unset( $option );
		$this->on_page_on_front( 0, $value );
	}

	/**
	 * `update_option_page_for_posts`: the old posts page is served again and the new one no longer is,
	 * each at its own path. Sent as an `update` from that path to itself, since the lookup's answer for
	 * the path changes while the path does not.
	 *
	 * @param mixed $old_value The value before.
	 * @param mixed $value     The value after.
	 */
	public function on_page_for_posts( mixed $old_value, mixed $value ): void {
		foreach ( array_unique( array( (int) $old_value, (int) $value ) ) as $page_id ) {
			$post = $page_id > 0 ? get_post( $page_id ) : null;

			if ( $post instanceof WP_Post && PagePath::POST_TYPE === $post->post_type && 'publish' === $post->post_status ) {
				$path = PagePath::own_path( $post );
				$this->queue->add( self::event( 'update', $post->ID, $path, $path ) );
			}
		}
	}

	/**
	 * `add_option_page_for_posts`: as an update from the default, 0.
	 *
	 * @param string $option The option name. Unused.
	 * @param mixed  $value  The value added.
	 */
	public function on_page_for_posts_added( string $option, mixed $value ): void {
		unset( $option );
		$this->on_page_for_posts( 0, $value );
	}

	/**
	 * Queues an `update` for a published page whose public path moved between `/` and its own path.
	 * Either side given as null means the page's own path. Nothing is queued for a page that is not
	 * published, since it is not served either way, or for the posts page.
	 *
	 * @param int         $page_id The page.
	 * @param string|null $from    The path before, or null for the page's own path.
	 * @param string|null $to      The path after, or null for the page's own path.
	 */
	private function moved( int $page_id, ?string $from, ?string $to ): void {
		$post = $page_id > 0 ? get_post( $page_id ) : null;

		if ( ! $post instanceof WP_Post || ! PagePath::is_served( $post ) ) {
			return;
		}

		$own = PagePath::own_path( $post );
		$this->queue->add( self::event( 'update', $post->ID, $to ?? $own, $from ?? $own ) );
	}

	/**
	 * Re-reads the top-level path of a `publish` or `update` event from the page and the options as
	 * they are now. Called by the dispatcher at `shutdown`, as {@see ResourceEvents::refresh()} is,
	 * so an event describes the page as the request left it. Removal events keep the path captured at
	 * the hook, and an event whose page is no longer served is returned as it was.
	 *
	 * @param array<string, mixed> $event A page event.
	 * @return array<string, mixed>
	 */
	public static function refresh( array $event ): array {
		if ( ! in_array( $event['event'], array( 'publish', 'update' ), true ) ) {
			return $event;
		}

		$post = get_post( (int) $event['id'] );

		if ( ! $post instanceof WP_Post || ! PagePath::is_served( $post ) ) {
			return $event;
		}

		$event['path'] = PagePath::of_post( $post );

		return $event;
	}

	/**
	 * A page event as the payload carries it (`pageEvent` in the request schema).
	 *
	 * @param string      $event    One of the five event names.
	 * @param int         $id       Post ID.
	 * @param string      $path     The public path the event concerns.
	 * @param string|null $previous The path before an `update`, else null.
	 * @return array<string, mixed>
	 */
	public static function event( string $event, int $id, string $path, ?string $previous ): array {
		return array(
			'type'     => 'page',
			'event'    => $event,
			'id'       => $id,
			'path'     => $path,
			'previous' => null === $previous ? null : array( 'path' => $previous ),
		);
	}
}
