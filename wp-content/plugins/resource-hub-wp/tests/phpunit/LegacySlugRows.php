<?php
/**
 * Plants rows whose slug carries a router-decoded escape, as they were stored before ADR 0024's rule.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests;

/**
 * Writes a slug straight into the row core is about to store, after every plugin filter has run,
 * standing in for a slug stored before {@see \ResourceHub\ContentModel\SlugEscapes} existed.
 */
trait LegacySlugRows {
	/**
	 * Runs a post save while forcing the `post_name` core writes.
	 *
	 * @param string   $slug The slug to store.
	 * @param callable $save Saves and returns the post ID.
	 */
	protected function with_legacy_post_slug( string $slug, callable $save ): int {
		$force = static function ( array $data ) use ( $slug ): array {
			$data['post_name'] = $slug;
			return $data;
		};

		add_filter( 'wp_insert_post_data', $force, 100 );

		try {
			return (int) $save();
		} finally {
			remove_filter( 'wp_insert_post_data', $force, 100 );
		}
	}

	/**
	 * Runs a term insert while forcing the slug core writes.
	 *
	 * @param string   $slug The slug to store.
	 * @param callable $save Inserts and returns the term ID.
	 */
	protected function with_legacy_term_slug( string $slug, callable $save ): int {
		$force = static function ( array $data ) use ( $slug ): array {
			$data['slug'] = $slug;
			return $data;
		};

		add_filter( 'wp_insert_term_data', $force, 100 );

		try {
			return (int) $save();
		} finally {
			remove_filter( 'wp_insert_term_data', $force, 100 );
		}
	}

	/**
	 * A post's stored slug, read past the cache.
	 *
	 * @param int $post_id Post ID.
	 */
	protected function stored_post_slug( int $post_id ): string {
		clean_post_cache( $post_id );

		return get_post( $post_id )->post_name;
	}

	/**
	 * A term's stored slug, read past the cache.
	 *
	 * @param int $term_id Term ID.
	 */
	protected function stored_term_slug( int $term_id ): string {
		clean_term_cache( $term_id );

		return get_term( $term_id )->slug;
	}
}
