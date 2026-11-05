<?php
/**
 * Shared setup for the lockdown tests.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Lockdown;

use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use WP_UnitTestCase;

/**
 * Pretty permalinks, as on the host, so feeds, sitemaps, `robots.txt` and the mirrored resource
 * paths resolve through rewrite rules the way they do there; plus the helpers every lockdown test
 * needs: a published resource with a type, and a visitor who is logged in or not.
 */
abstract class LockdownTestCase extends WP_UnitTestCase {
	/**
	 * Sets the permalink structure, which resets core's rewrite object and drops the post type's
	 * permastructure and the taxonomy's rewrite tag, so both are registered again, as activation does.
	 */
	public function set_up(): void {
		parent::set_up();
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();
		$this->anonymous();
	}

	/**
	 * Back to plain permalinks, as the other tests expect.
	 */
	public function tear_down(): void {
		$this->set_permalink_structure( '' );
		parent::tear_down();
	}

	/**
	 * Every `go_to()` is a fresh request. The gate registers its guards for the rest of the request
	 * it locks, and a real request is a new PHP process, so the hooks go back to the state backed up
	 * at `set_up()` before each one; otherwise an anonymous request's guards would leak into the
	 * logged-in request a test makes after it.
	 *
	 * @param string $url The URL for the request.
	 */
	public function go_to( $url ) {
		$this->_restore_hooks();
		parent::go_to( $url );
	}

	/**
	 * Nobody is logged in.
	 */
	protected function anonymous(): void {
		wp_set_current_user( 0 );
	}

	/**
	 * A logged-in user with no capabilities to speak of: being logged in is what counts.
	 */
	protected function logged_in(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
	}

	/**
	 * The object of the given class the plugin hooked to a filter at a priority, through the
	 * registered callback, so a test exercises the instance that is live rather than a new one.
	 *
	 * @param string $hook       Hook name.
	 * @param string $class_name Class of the callback's object.
	 * @param int    $priority   Priority it was hooked at.
	 */
	protected function registered( string $hook, string $class_name, int $priority = 10 ): object {
		foreach ( $GLOBALS['wp_filter'][ $hook ]->callbacks[ $priority ] ?? array() as $callback ) {
			if ( is_array( $callback['function'] ) && $callback['function'][0] instanceof $class_name ) {
				return $callback['function'][0];
			}
		}

		$this->fail( "No {$class_name} is hooked to {$hook} at priority {$priority}." );
	}

	/**
	 * A published resource of the given slug and type.
	 *
	 * @param string $slug Post slug.
	 * @param string $type Type slug.
	 */
	protected function resource( string $slug = 'the-headless-handbook', string $type = 'ebook' ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_type'   => PostType::NAME,
				'post_status' => 'publish',
				'post_name'   => $slug,
				'post_title'  => $slug,
			)
		);

		wp_set_object_terms( $post_id, $this->type( $type ), Taxonomies::TYPE );

		return $post_id;
	}

	/**
	 * The ID of the type with this slug, created if missing.
	 *
	 * @param string $slug Type slug.
	 */
	protected function type( string $slug ): int {
		$term = get_term_by( 'slug', $slug, Taxonomies::TYPE );

		if ( $term ) {
			return $term->term_id;
		}

		return self::factory()->term->create(
			array(
				'taxonomy' => Taxonomies::TYPE,
				'slug'     => $slug,
				'name'     => $slug,
			)
		);
	}
}
