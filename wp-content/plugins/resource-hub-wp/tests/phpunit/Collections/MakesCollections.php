<?php
/**
 * Shared set-up for the collection tests: pretty permalinks with the plugin's rules, and the content a collection lists.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Collections;

use ResourceHub\Collections\Lead;
use ResourceHub\Collections\Routes;
use ResourceHub\ContentModel\Meta;
use ResourceHub\ContentModel\PostType;
use ResourceHub\ContentModel\Taxonomies;
use ResourceHub\Search\SearchPath;
use WP_Term;

/**
 * Pretty permalinks with the plugin's rewrite rules (the collections' and the search page's), terms by slug,
 * published resources and the featured flag.
 *
 * Setting the permalink structure resets core's rewrite object, which drops the post type's
 * permastructure, the taxonomies' rewrite tags and the rules the plugin added at `init`, so
 * `use_pretty_permalinks()` registers all three again, as activation does, and forgets the stored
 * rules so the next request regenerates them. A class that uses it calls `use_plain_permalinks()`
 * in `tear_down()`, as `PermalinkTest` does.
 */
trait MakesCollections {
	/**
	 * Pretty permalinks with a trailing slash, the post type, the taxonomies and the plugin's collection and search rules.
	 */
	private function use_pretty_permalinks(): void {
		$this->set_permalink_structure( '/%postname%/' );
		( new PostType() )->register();
		( new Taxonomies() )->register();
		( new Routes() )->add_rules();
		( new SearchPath() )->add_rules();
		delete_option( 'rewrite_rules' );
		Lead::forget();
	}

	/**
	 * Back to plain permalinks, as the other tests expect.
	 */
	private function use_plain_permalinks(): void {
		Lead::forget();
		$this->set_permalink_structure( '' );
	}

	/**
	 * The term with this slug in a taxonomy, created with `$name` (or the slug) if missing.
	 *
	 * @param string      $taxonomy `resource_type` or `resource_topic`.
	 * @param string      $slug     The slug.
	 * @param string|null $name     The name; the slug when null.
	 */
	private function term( string $taxonomy, string $slug, ?string $name = null ): WP_Term {
		$term = get_term_by( 'slug', $slug, $taxonomy );

		if ( $term instanceof WP_Term ) {
			return $term;
		}

		$id   = self::factory()->term->create(
			array(
				'taxonomy' => $taxonomy,
				'slug'     => $slug,
				'name'     => $name ?? $slug,
			)
		);
		$term = get_term( $id, $taxonomy );
		$this->assertInstanceOf( WP_Term::class, $term );

		return $term;
	}

	/**
	 * A published resource with one type, some topics, a summary and a date; its ID.
	 *
	 * @param string   $title  The title.
	 * @param string   $type   The type's slug.
	 * @param string[] $topics The topics' slugs.
	 * @param string   $date   The publish date, `Y-m-d H:i:s`, in GMT.
	 */
	private function resource( string $title, string $type, array $topics, string $date = '2026-11-01 09:30:00' ): int {
		$id = self::factory()->post->create(
			array(
				'post_type'     => PostType::NAME,
				'post_status'   => 'publish',
				'post_title'    => $title,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			)
		);
		wp_set_object_terms( $id, array( $this->term( Taxonomies::TYPE, $type )->term_id ), Taxonomies::TYPE );
		wp_set_object_terms( $id, array_map( fn ( string $slug ): int => $this->term( Taxonomies::TOPIC, $slug )->term_id, $topics ), Taxonomies::TOPIC );
		update_post_meta( $id, Meta::SUMMARY, 'A summary of ' . $title . '.' );

		return $id;
	}

	/**
	 * Flags a resource as featured, and forgets any lead already found.
	 *
	 * @param int $id The resource.
	 */
	private function feature( int $id ): void {
		wp_set_object_terms( $id, array( ( new Taxonomies() )->ensure_featured_flag() ), Taxonomies::FLAG );
		Lead::forget();
	}

	/**
	 * The theme's collection part, rendered for the current request, as its templates render it.
	 */
	private function render_collection_part(): string {
		$file = WP_CONTENT_DIR . '/themes/resource-hub/parts/collection.html';
		$this->assertFileIsReadable( $file );

		return do_blocks( (string) file_get_contents( $file ) ); // phpcs:ignore WordPressVIPMinimum.Performance.FetchingRemoteData.FileGetContentsUnknown -- The theme's own template part, read by a test.
	}

	/**
	 * One of the plugin's collection blocks, rendered for the current request with no context.
	 *
	 * @param string $name The block's name.
	 */
	private function render_block( string $name ): string {
		return do_blocks( '<!-- wp:' . $name . ' /-->' );
	}
}
